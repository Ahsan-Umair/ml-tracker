from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import database, recovery
from app.main import app
from app.security import digest, iso, utcnow

EMAIL = "owner@example.com"
OLD = "old-password-with-entropy"
NEW = "  replacement-password-with-spaces  "


def register(client, email=EMAIL):
    response = client.post("/api/auth/register", json={"email": email, "display_name": "Owner", "password": OLD})
    assert response.status_code == 201
    return response.json()


def issue(client, auth):
    response = client.post("/api/auth/recovery-code", headers={"X-CSRF-Token": auth["csrfToken"]}, json={"password": OLD})
    assert response.status_code == 200
    return response.json()["recoveryCode"]


def reset(client, code, email=EMAIL, password=NEW):
    return client.post("/api/auth/recover", json={"email": email, "recovery_code": code, "password": password})


def test_recovery_revokes_sessions_preserves_data_and_rotates_codes():
    with TestClient(app) as owner, TestClient(app) as other_session:
        auth = register(owner)
        other_session.post("/api/auth/login", json={"email": EMAIL, "password": OLD})
        project = owner.post("/api/projects", headers={"X-CSRF-Token": auth["csrfToken"]}, json={"name": "Keep my models"}).json()
        code = issue(owner, auth)
        stored = database.one("SELECT * FROM recovery_credentials WHERE user_id=?", (auth["user"]["id"],))
        assert stored["code_hash"] == digest(code) and code not in str(stored)
        response = reset(owner, code)
        assert response.status_code == 200
        assert "no-store" in response.headers["cache-control"]
        replacement = response.json()["recoveryCode"]
        assert replacement != code and len(replacement) >= 40
        assert owner.get("/api/auth/me").status_code == 401
        assert other_session.get("/api/auth/me").status_code == 401
        assert owner.post("/api/auth/login", json={"email": EMAIL, "password": OLD}).status_code == 401
        assert owner.post("/api/auth/login", json={"email": EMAIL, "password": NEW}).status_code == 200
        assert owner.get("/api/projects").json()[0]["id"] == project["id"]
        assert reset(owner, code).status_code == 400
        assert reset(owner, replacement, password="another-long-password").status_code == 200


def test_invalid_expired_and_wrong_account_codes_are_indistinguishable():
    with TestClient(app) as client:
        auth = register(client)
        code = issue(client, auth)
        nonexistent = reset(client, code, email="missing@example.com")
        wrong = reset(client, "invalid-code")
        database.execute("UPDATE recovery_credentials SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
        expired = reset(client, code)
        assert nonexistent.status_code == wrong.status_code == expired.status_code == 400
        assert nonexistent.json() == wrong.json() == expired.json()
        assert client.post("/api/auth/login", json={"email": EMAIL, "password": OLD}).status_code == 200


def test_code_generation_requires_session_csrf_password_and_origin():
    with TestClient(app) as client:
        assert client.post("/api/auth/recovery-code", json={"password": OLD}).status_code == 401
        auth = register(client)
        assert client.post("/api/auth/recovery-code", json={"password": OLD}).status_code == 403
        headers = {"X-CSRF-Token": auth["csrfToken"]}
        assert client.post("/api/auth/recovery-code", headers=headers, json={"password": "incorrect"}).status_code == 400
        assert client.post("/api/auth/recovery-code", headers={**headers, "Origin": "https://evil.example"}, json={"password": OLD}).status_code == 403
        code = issue(client, auth)
        assert client.post("/api/auth/recover", headers={"Origin": "https://evil.example"}, json={"email": EMAIL, "recovery_code": code, "password": NEW}).status_code == 403
        assert reset(client, code, password="short").status_code == 422
        assert reset(client, code).status_code == 200


def test_recovery_rate_limit_survives_app_restart():
    with TestClient(app) as client:
        for _ in range(5):
            assert reset(client, "invalid").status_code == 400
    with TestClient(app) as restarted:
        response = reset(restarted, "invalid")
        assert response.status_code == 429
        assert response.headers["retry-after"] == "900"
        database.execute("UPDATE recovery_attempts SET window_start=0")
        assert reset(restarted, "invalid").status_code == 400


def test_bootstrap_is_owner_only_and_never_reenabled_on_restart(monkeypatch):
    with TestClient(app) as client:
        auth = register(client)
        register(client, "second@example.com")
        raw = "test-only-emergency-code-with-sufficient-entropy"
        monkeypatch.setenv("OWNER_EMAIL", EMAIL)
        monkeypatch.setenv("OWNER_RECOVERY_CODE_HASH", digest(raw))
        monkeypatch.setenv("OWNER_RECOVERY_EXPIRES_AT", iso(utcnow() + timedelta(hours=24)))
        recovery.bootstrap_owner_recovery()
        assert database.one("SELECT user_id FROM recovery_credentials")["user_id"] == auth["user"]["id"]
        assert reset(client, raw, email="second@example.com").status_code == 400
        result = reset(client, raw)
        assert result.status_code == 200
        recovery.bootstrap_owner_recovery()
        assert reset(client, raw).status_code == 400
        assert reset(client, result.json()["recoveryCode"]).status_code == 200


def test_concurrent_recovery_consumes_code_exactly_once(monkeypatch):
    with TestClient(app) as client:
        code = issue(client, register(client))
        barrier = Barrier(2)
        original = recovery.hash_password
        def synchronize(password):
            result = original(password)
            barrier.wait(timeout=10)
            return result
        monkeypatch.setattr(recovery, "hash_password", synchronize)
        def attempt():
            try:
                recovery.recover_account(EMAIL, code, NEW)
                return 200
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        assert sorted(results) == [200, 400]


def test_failed_password_update_rolls_back_code_consumption():
    with TestClient(app) as client:
        auth = register(client)
        code = issue(client, auth)
        database.execute("CREATE TRIGGER fail_password BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with pytest.raises(Exception, match="test failure"):
            recovery.recover_account(EMAIL, code, NEW)
        assert database.one("SELECT code_hash FROM recovery_credentials")["code_hash"] == digest(code)
        assert client.get("/api/auth/me").status_code == 200
        database.execute("DROP TRIGGER fail_password")
        assert reset(client, code).status_code == 200
