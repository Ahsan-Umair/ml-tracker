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
    assert database.one("SELECT MAX(version) AS version FROM schema_migrations")["version"] == database.SCHEMA_VERSION


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
    assert database.one("SELECT MAX(version) AS version FROM schema_migrations")["version"] == database.SCHEMA_VERSION


def test_version_one_upgrade_preserves_sessions_and_accepts_legacy_cutover_sessions():
    from app.security import SESSION_COOKIE, digest, session_csrf

    raw_token = 'old-host-session-token'
    expires = '2099-01-01T00:00:00+00:00'
    with database.connection() as conn:
        for statement in database.SCHEMA:
            conn.execute(statement)
        conn.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)')
        conn.execute('INSERT INTO schema_migrations(version) VALUES(1)')
        conn.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',
                     ('legacy-owner', 'legacy@example.com', 'Legacy Owner', 'unused-hash', 'old-created', 'old-updated'))
        conn.execute('INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at) VALUES(?,?,?,?,?)',
                     (digest(raw_token), 'legacy-owner', digest(session_csrf(raw_token)), expires, 'old-created'))
    database.initialize_database()
    assert database.one('SELECT display_name FROM users WHERE id=?', ('legacy-owner',))['display_name'] == 'Legacy Owner'
    assert database.one('SELECT COUNT(*) AS count FROM schema_migrations')['count'] == database.SCHEMA_VERSION

    # The source service can still write its old explicit-column INSERT while
    # traffic is being cut over. Session management must handle its nullable id.
    database.execute('INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at) VALUES(?,?,?,?,?)',
                     (digest('concurrent-old-host-token'), 'legacy-owner', 'unused', expires, 'old-created'))
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE, raw_token)
        assert client.get('/api/auth/me').status_code == 200
        sessions = client.get('/api/auth/sessions').json()
        assert len(sessions) == 2
        assert all(session['id'] for session in sessions)
        legacy = next(session for session in sessions if not session['current'])
        headers = {'X-CSRF-Token': session_csrf(raw_token)}
        assert client.delete('/api/auth/sessions/' + legacy['id'], headers=headers).status_code == 204
        assert len(client.get('/api/auth/sessions').json()) == 1
