import sqlite3

from fastapi.testclient import TestClient

from app import database, main
from app.main import app


def test_schema_migration_preserves_existing_data_and_skips_ddl_on_restart(monkeypatch):
    database.initialize_database()
    database.execute("INSERT INTO users VALUES(?,?,?,?,?,?)", ("u", "user@example.com", "Owner", "hash", "now", "now"))
    database.execute("DROP TABLE schema_migrations")
    database.initialize_database()
    assert database.one("SELECT id FROM users")["id"] == "u"
    statements = []
    connect = database._connect
    def traced_connect():
        conn = connect()
        conn.set_trace_callback(statements.append)
        return conn
    monkeypatch.setattr(database, "_connect", traced_connect)
    database.initialize_database()
    assert not any("CREATE INDEX" in sql or "CREATE TABLE IF NOT EXISTS users" in sql for sql in statements)
    assert database.one("SELECT version FROM schema_migrations")["version"] == database.SCHEMA_VERSION


def test_health_does_not_query_database_and_readiness_reports_failure(monkeypatch):
    with TestClient(app) as client:
        def unavailable(*args):
            raise sqlite3.OperationalError("offline")
        monkeypatch.setattr(main, "one", unavailable)
        assert client.get("/api/health").json() == {"status": "healthy"}
        assert client.get("/api/ready").status_code == 503


def test_dashboard_and_analytics_reuse_connections(monkeypatch):
    with TestClient(app) as client:
        assert client.post("/api/auth/register", json={"display_name": "Owner", "email": "owner@example.com", "password": "a-long-test-password"}).status_code == 201
        connect = database._connect
        calls = []
        def counted_connect():
            calls.append(1)
            return connect()
        monkeypatch.setattr(database, "_connect", counted_connect)
        for path in ("/api/dashboard", "/api/analytics"):
            calls.clear()
            assert client.get(path).status_code == 200
            assert len(calls) == 2  # Authentication, then all related reads.


def test_schema_migration_works_with_production_libsql_driver(tmp_path, monkeypatch):
    import libsql
    def local_libsql():
        conn = libsql.connect(str(tmp_path / "libsql.db"))
        conn.execute("PRAGMA foreign_keys = ON")
        return conn
    monkeypatch.setattr(database, "_connect", local_libsql)
    database.initialize_database()
    database.initialize_database()
    assert database.one("SELECT version FROM schema_migrations")["version"] == database.SCHEMA_VERSION
