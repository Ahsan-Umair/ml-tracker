import pytest

from app import database
from app.main import auth_attempts


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    for key in ("TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "OWNER_EMAIL", "REGISTRATION_TOKEN", "LOCAL_DATABASE_PATH", "APP_ENV"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("ALLOW_REGISTRATION", "true")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setattr(database, "LOCAL_DB", tmp_path / "isolated.db")
    auth_attempts.clear()
    yield
    auth_attempts.clear()
