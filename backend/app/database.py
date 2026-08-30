from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from typing import Any, Iterator, Sequence

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parents[1]
LOCAL_DB = BASE_DIR / "data" / "model_lab.db"
DB_LOCK = Lock()


SCHEMA: tuple[str, ...] = (
    """CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_hash TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#7357F6',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT 'v1',
        format TEXT NOT NULL DEFAULT 'other',
        uri TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
        row_count INTEGER CHECK(row_count IS NULL OR row_count >= 0),
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        framework TEXT NOT NULL DEFAULT 'Other',
        task_type TEXT NOT NULL DEFAULT 'Other',
        status TEXT NOT NULL DEFAULT 'development' CHECK(status IN ('development','staging','production','archived')),
        repository_url TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS model_versions (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'candidate' CHECK(stage IN ('candidate','staging','production','archived')),
        artifact_uri TEXT NOT NULL DEFAULT '',
        parameters_count INTEGER CHECK(parameters_count IS NULL OR parameters_count >= 0),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(model_id, version)
    )""",
    """CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        dataset_id TEXT REFERENCES datasets(id) ON DELETE SET NULL,
        model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','completed','failed','archived')),
        objective TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        model_version_id TEXT REFERENCES model_versions(id) ON DELETE SET NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        run_type TEXT NOT NULL DEFAULT 'training' CHECK(run_type IN ('training','evaluation','inference')),
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('queued','running','completed','failed','cancelled')),
        hyperparameters TEXT NOT NULL DEFAULT '{}',
        environment TEXT NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        step INTEGER CHECK(step IS NULL OR step >= 0),
        logged_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_datasets_user_project ON datasets(user_id, project_id)",
    "CREATE INDEX IF NOT EXISTS idx_models_user_project ON models(user_id, project_id)",
    "CREATE INDEX IF NOT EXISTS idx_versions_user_model ON model_versions(user_id, model_id)",
    "CREATE INDEX IF NOT EXISTS idx_experiments_user_project ON experiments(user_id, project_id)",
    "CREATE INDEX IF NOT EXISTS idx_runs_user_experiment ON runs(user_id, experiment_id)",
    "CREATE INDEX IF NOT EXISTS idx_metrics_run_name_step ON metrics(run_id, name, step)",
)


def _connect():
    url = os.getenv("TURSO_DATABASE_URL", "").strip()
    token = os.getenv("TURSO_AUTH_TOKEN", "").strip()
    if os.getenv("APP_ENV") == "production" and (not url or not token):
        raise RuntimeError("Production requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN")
    if url:
        if not url.startswith("libsql://") or not token:
            raise RuntimeError("Configure a libsql:// Turso database URL and its auth token")
        import libsql

        conn = libsql.connect(database=url, auth_token=token)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    local_path = Path(os.getenv("LOCAL_DATABASE_PATH", str(LOCAL_DB)))
    local_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(local_path, timeout=20, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


@contextmanager
def connection() -> Iterator[Any]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _rows(cursor: Any) -> list[dict[str, Any]]:
    columns = [item[0] for item in cursor.description or []]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def query(sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    with DB_LOCK, connection() as conn:
        return _rows(conn.execute(sql, tuple(params)))


def one(sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Sequence[Any] = ()) -> None:
    with DB_LOCK, connection() as conn:
        conn.execute(sql, tuple(params))


def execute_many(sql: str, params: Sequence[Sequence[Any]]) -> None:
    with DB_LOCK, connection() as conn:
        conn.executemany(sql, [tuple(row) for row in params])


def initialize_database() -> None:
    with DB_LOCK, connection() as conn:
        for statement in SCHEMA:
            conn.execute(statement)
        try:
            conn.execute("PRAGMA optimize")
        except Exception:
            pass
