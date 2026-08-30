import sqlite3

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import database
from app.main import app
from app.schemas import MetricInput


def register(client, email="owner@example.com", **extra):
    return client.post("/api/auth/register", json={"display_name": "Owner", "email": email, "password": "  a-long-passphrase  ", **extra})


def test_owner_setup_requires_email_and_private_code(monkeypatch):
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("REGISTRATION_TOKEN", "a" * 48)
    with TestClient(app) as client:
        assert register(client).status_code == 403
        assert register(client, "other@example.com", registration_token="a" * 48).status_code == 403
        assert register(client, registration_token="a" * 48).status_code == 201
        assert register(client, registration_token="a" * 48).status_code == 409


def test_multi_tab_csrf_password_and_cache_headers():
    with TestClient(app) as client:
        original = register(client).json()["csrfToken"]
        assert client.get("/api/auth/csrf").json()["csrfToken"] == original
        assert client.get("/api/auth/csrf").json()["csrfToken"] == original
        headers = {"X-CSRF-Token": original}
        assert client.post("/api/projects", json={"name": "Private"}, headers=headers).status_code == 201
        assert "no-store" in client.get("/api/projects").headers["cache-control"]
        assert client.post("/api/projects", json={"name": "Bad"}, headers={**headers, "Origin": "https://evil.example"}).status_code == 403
        assert client.post("/api/auth/logout", headers=headers).status_code == 204
        assert client.post("/api/auth/login", json={"email": "owner@example.com", "password": "a-long-passphrase"}).status_code == 401
        assert client.post("/api/auth/login", json={"email": "owner@example.com", "password": "  a-long-passphrase  "}).status_code == 200


def test_cross_user_access_and_cascade():
    with TestClient(app) as alice, TestClient(app) as bob:
        ah = {"X-CSRF-Token": register(alice, "alice@example.com").json()["csrfToken"]}
        bh = {"X-CSRF-Token": register(bob, "bob@example.com").json()["csrfToken"]}
        project = alice.post("/api/projects", json={"name": "Alice"}, headers=ah).json()
        dataset = {"project_id": project["id"], "name": "Private data"}
        assert bob.get("/api/projects").json() == []
        assert bob.post("/api/datasets", json=dataset, headers=bh).status_code == 404
        assert bob.delete(f"/api/projects/{project['id']}", headers=bh).status_code == 404
        assert alice.post("/api/datasets", json=dataset, headers=ah).status_code == 201
        assert alice.delete(f"/api/projects/{project['id']}", headers=ah).status_code == 204
        assert alice.get("/api/datasets").json() == []
        assert database.query("SELECT * FROM datasets") == []


def test_bad_logins_are_throttled():
    with TestClient(app) as client:
        for _ in range(10):
            assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"}).status_code == 401
        assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong"}).status_code == 429


def test_production_never_falls_back_to_local_storage(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="Production requires TURSO"):
        database._connect()


def test_local_foreign_keys_and_finite_metrics():
    database.initialize_database()
    with pytest.raises(sqlite3.IntegrityError):
        database.execute("INSERT INTO projects VALUES(?,?,?,?,?,?,?)", ("p", "missing", "bad", "", "#000000", "now", "now"))
    for value in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValidationError):
            MetricInput(name="accuracy", value=value)
