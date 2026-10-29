"""Account-boundary regressions independent of the main workspace flow."""

from fastapi.testclient import TestClient

from app import database
from app.main import app

PASSWORD = "account-boundary-test-password"


def register(client, email="owner@example.com"):
    result = client.post(
        "/api/auth/register",
        json={"email": email, "display_name": "Test Owner", "password": PASSWORD},
    )
    assert result.status_code == 201
    return {"X-CSRF-Token": result.json()["csrfToken"]}


def token(client, headers, **extra):
    result = client.post(
        "/api/auth/tokens",
        headers=headers,
        json={"name": "Test logger", "password": PASSWORD, "scopes": ["read"], **extra},
    )
    assert result.status_code == 201
    return result.json()


def test_wrong_password_or_missing_csrf_cannot_change_security_state():
    with TestClient(app) as client:
        headers = register(client)
        credential = token(client, headers)
        original_sessions = client.get("/api/auth/sessions").json()
        assert client.post(
            "/api/auth/password",
            json={"current_password": PASSWORD, "password": "replacement-test-password"},
        ).status_code == 403
        assert client.post(
            "/api/auth/password",
            headers=headers,
            json={"current_password": "incorrect", "password": "replacement-test-password"},
        ).status_code == 400
        assert client.post(
            "/api/auth/tokens",
            headers=headers,
            json={"name": "Unauthorized", "password": "incorrect", "scopes": ["write"]},
        ).status_code == 400
        assert client.get("/api/auth/sessions").json() == original_sessions
        assert len(client.get("/api/auth/tokens").json()) == 1
        assert client.get(
            "/api/projects", headers={"Authorization": "Bearer " + credential["token"]}
        ).status_code == 200


def test_expired_or_malformed_bearer_never_falls_back_to_a_valid_cookie():
    with TestClient(app) as client:
        headers = register(client)
        credential = token(client, headers)
        listed = client.get("/api/auth/tokens").json()[0]
        assert not {"token", "token_hash", "password", "password_hash"} & listed.keys()
        database.execute(
            "UPDATE api_tokens SET expires_at=? WHERE id=?",
            ("2000-01-01T00:00:00+00:00", credential["id"]),
        )
        assert client.get("/api/auth/me").status_code == 200
        for authorization in ("Bearer " + credential["token"], "Bearer invalid", "Basic invalid"):
            assert client.get(
                "/api/projects", headers={"Authorization": authorization}
            ).status_code == 401


def test_foreign_sessions_and_tokens_cannot_be_revoked():
    with TestClient(app) as owner, TestClient(app) as other:
        owner_headers = register(owner)
        credential = token(owner, owner_headers)
        session = owner.get("/api/auth/sessions").json()[0]
        other_headers = register(other, "other@example.com")
        assert other.delete(
            "/api/auth/sessions/" + session["id"], headers=other_headers
        ).status_code == 404
        assert other.delete(
            "/api/auth/tokens/" + credential["id"], headers=other_headers
        ).status_code == 404
        assert owner.get("/api/auth/me").status_code == 200
        assert owner.get(
            "/api/projects", headers={"Authorization": "Bearer " + credential["token"]}
        ).status_code == 200
        assert owner.delete(
            "/api/auth/sessions/" + session["id"], headers=owner_headers
        ).status_code == 204
        assert owner.get("/api/auth/me").status_code == 401


def test_scoped_write_tokens_cannot_reparent_records_or_manage_the_account():
    with TestClient(app) as client:
        headers = register(client)
        projects = []
        for name in ("Allowed", "Private"):
            result = client.post("/api/projects", headers=headers, json={"name": name})
            assert result.status_code == 201
            projects.append(result.json())
        dataset = client.post(
            "/api/datasets", headers=headers,
            json={"project_id": projects[0]["id"], "name": "Training data"},
        ).json()
        credential = token(client, headers, project_id=projects[0]["id"], scopes=["write"])
        bearer = {"Authorization": "Bearer " + credential["token"]}
        assert client.patch(
            "/api/datasets/" + dataset["id"], headers=bearer,
            json={"project_id": projects[1]["id"]},
        ).status_code == 422  # Parent relationships are immutable for metadata edits.
        assert client.delete(
            "/api/projects/" + projects[1]["id"], headers=bearer
        ).status_code == 404
        for method, path, body in (
            ("get", "/api/auth/tokens", None),
            ("get", "/api/auth/sessions", None),
            ("get", "/api/workspace/export", None),
            ("post", "/api/auth/password", {"current_password": PASSWORD, "password": "replacement-test-password"}),
        ):
            assert client.request(method, path, headers=bearer, **({"json": body} if body else {})).status_code == 403
        assert client.get("/api/datasets/" + dataset["id"]).json()["project_id"] == projects[0]["id"]
        assert client.get("/api/projects/" + projects[1]["id"]).status_code == 200


def test_recovery_revokes_api_tokens_as_well_as_sessions():
    with TestClient(app) as client:
        headers = register(client)
        credential = token(client, headers, scopes=["write"])
        issued = client.post(
            "/api/auth/recovery-code", headers=headers, json={"password": PASSWORD}
        )
        assert issued.status_code == 200
        recovered = client.post(
            "/api/auth/recover",
            json={"email": "owner@example.com", "recovery_code": issued.json()["recoveryCode"], "password": "replacement-test-password"},
        )
        assert recovered.status_code == 200
        assert client.get("/api/auth/me").status_code == 401
        assert client.get(
            "/api/projects", headers={"Authorization": "Bearer " + credential["token"]}
        ).status_code == 401
