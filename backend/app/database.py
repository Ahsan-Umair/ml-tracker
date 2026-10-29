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


SCHEMA_VERSION = 3

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
    """CREATE TABLE IF NOT EXISTS recovery_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS recovery_bootstraps (
        code_hash TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS recovery_attempts (
        identity_hash TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        window_start INTEGER NOT NULL
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
    "CREATE INDEX IF NOT EXISTS idx_metrics_user_name_time ON metrics(user_id, name, logged_at)",
    "CREATE INDEX IF NOT EXISTS idx_runs_user_created ON runs(user_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_runs_model_version ON runs(model_version_id)",
    "CREATE INDEX IF NOT EXISTS idx_versions_model ON model_versions(model_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)",
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
    with connection() as conn:
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


class Reader:
    """Reuse one connection for related reads without sharing it across threads."""

    def __init__(self, conn: Any):
        self.conn = conn

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        return _rows(self.conn.execute(sql, tuple(params)))

    def one(self, sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None


@contextmanager
def read_connection(*, snapshot: bool = False) -> Iterator[Reader]:
    with connection() as conn:
        if snapshot:
            conn.execute("BEGIN")
        yield Reader(conn)


def initialize_database() -> None:
    with DB_LOCK, connection() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)")
        version = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0]
        if version >= SCHEMA_VERSION:
            return
        conn.execute("BEGIN IMMEDIATE")
        # A second instance may have finished while this one waited for the write lock.
        version = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0]
        if version >= SCHEMA_VERSION:
            return
        # Each migration is recorded in the same transaction as its DDL. Existing
        # version-1 databases are upgraded in place without replacing any records.
        if version < 1:
            for statement in SCHEMA:
                conn.execute(statement)
            conn.execute("INSERT INTO schema_migrations(version) VALUES (1)")
        if version < 2:
            for table in ("projects", "datasets", "models", "experiments", "runs"):
                _add_column(conn, table, "tags", "TEXT NOT NULL DEFAULT '[]'")
            _add_column(conn, "projects", "archived_at", "TEXT")
            _add_column(conn, "datasets", "checksum", "TEXT NOT NULL DEFAULT ''")
            _add_column(conn, "model_versions", "checksum", "TEXT NOT NULL DEFAULT ''")
            _add_column(conn, "experiments", "primary_metric", "TEXT NOT NULL DEFAULT 'val_accuracy'")
            _add_column(conn, "experiments", "metric_direction", "TEXT NOT NULL DEFAULT 'max'")
            _add_column(conn, "experiments", "metric_aggregation", "TEXT NOT NULL DEFAULT 'best'")
            _add_column(conn, "experiments", "metric_unit", "TEXT NOT NULL DEFAULT 'fraction'")
            _add_column(conn, "experiments", "metric_split", "TEXT NOT NULL DEFAULT 'validation'")
            _add_column(conn, "runs", "provenance", "TEXT NOT NULL DEFAULT '{}'")
            _add_column(conn, "runs", "parent_run_id", "TEXT REFERENCES runs(id) ON DELETE SET NULL")
            _add_column(conn, "metrics", "unit", "TEXT NOT NULL DEFAULT ''")
            _add_column(conn, "metrics", "split", "TEXT NOT NULL DEFAULT ''")
            _add_column(conn, "sessions", "id", "TEXT")
            conn.execute("UPDATE sessions SET id='ses_' || substr(token_hash,1,24) WHERE id IS NULL")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_id ON sessions(id)")
            conn.execute("""CREATE TABLE IF NOT EXISTS auth_rate_limits (
                identity_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start INTEGER NOT NULL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS api_tokens (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, prefix TEXT NOT NULL,
                scopes TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT)""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)")
            conn.execute("""CREATE TABLE IF NOT EXISTS metric_batches (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL,
                created_at TEXT NOT NULL, PRIMARY KEY(user_id,run_id,idempotency_key))""")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_metrics_score ON metrics(run_id,name,split,unit,step,logged_at)")
            conn.execute("INSERT INTO schema_migrations(version) VALUES (2)")
        if version < 3:
            _add_column(conn, "experiments", "metric_policy_confirmed", "INTEGER NOT NULL DEFAULT 1")
            _annotate_legacy_metrics(conn, include_all_experiments=version < 2)
            conn.execute("INSERT INTO schema_migrations(version) VALUES (3)")


def _add_column(conn: Any, table: str, column: str, declaration: str) -> None:
    # Names are internal constants; callers cannot supply SQL identifiers.
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")


def _annotate_legacy_metrics(conn: Any, *, include_all_experiments: bool) -> None:
    """Preserve old raw readings and their old fraction/percentage display rule.

    The old application did not record units or an evaluation protocol. A mixed
    history must be reviewed, rather than silently treating .95 and 95 as equal
    numeric inputs to one ranking. Explicitly configured version-2 records keep
    their policy; only unannotated legacy histories are adopted here.
    """
    accuracy_names = ('accuracy', 'val_accuracy', 'validation_accuracy', 'test_accuracy', 'val_acc', 'test_acc')
    marks = ','.join('?' for _ in accuracy_names)
    if include_all_experiments:
        experiments = conn.execute('SELECT id FROM experiments').fetchall()
    else:
        experiments = conn.execute(f'''SELECT DISTINCT r.experiment_id FROM metrics me
            JOIN runs r ON r.id=me.run_id WHERE me.unit='' AND me.name IN ({marks})''', accuracy_names).fetchall()
    conn.execute(f'''UPDATE metrics SET unit=CASE
        WHEN value BETWEEN 0 AND 1 THEN 'fraction'
        WHEN value>1 AND value<=100 THEN 'percent' ELSE 'number' END
        WHERE unit='' AND name IN ({marks})''', accuracy_names)
    for (experiment_id,) in experiments:
        readings = conn.execute('''SELECT DISTINCT me.name,me.unit FROM metrics me
            JOIN runs r ON r.id=me.run_id WHERE r.experiment_id=?''', (experiment_id,)).fetchall()
        if not readings:
            continue
        names = {row[0] for row in readings if row[0] in accuracy_names}
        primary = next(iter(names)) if len(names) == 1 else 'val_accuracy'
        units = {row[1] for row in readings if row[0] == primary}
        unit = next(iter(units)) if len(units) == 1 and units <= {'fraction', 'percent'} else 'fraction'
        split = 'validation' if primary in {'val_accuracy', 'validation_accuracy', 'val_acc'} else 'test' if primary in {'test_accuracy', 'test_acc'} else ''
        confirmed = len(names) == 1 and len(units) == 1 and units <= {'fraction', 'percent'} and bool(split)
        conn.execute('''UPDATE experiments SET primary_metric=?,metric_unit=?,metric_split=?,metric_policy_confirmed=? WHERE id=?''',
                     (primary, unit, split, int(confirmed), experiment_id))
