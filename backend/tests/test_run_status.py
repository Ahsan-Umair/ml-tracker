from fastapi.testclient import TestClient

from app.main import app


def test_experiment_status_tracks_all_runs_and_preserves_archival():
    with TestClient(app) as client:
        account = client.post("/api/auth/register", json={"display_name": "Owner", "email": "owner@example.com", "password": "a-long-test-password"}).json()
        headers = {"X-CSRF-Token": account["csrfToken"]}
        project = client.post("/api/projects", headers=headers, json={"name": "Vision"}).json()
        experiment = client.post("/api/experiments", headers=headers, json={"project_id": project["id"], "name": "Ablation"}).json()
        def status():
            return client.get("/api/experiments").json()[0]["status"]
        def run(name, state):
            result = client.post("/api/runs", headers=headers, json={"experiment_id": experiment["id"], "name": name, "status": state})
            assert result.status_code == 201
            return result.json()["id"]
        def change(record_id, state):
            result = client.patch(f"/api/runs/{record_id}/status", headers=headers, json={"status": state})
            assert result.status_code == 200
            return result.json()
        completed = run("Finished", "completed")
        assert status() == "completed"
        active = run("Queued", "queued")
        assert status() == "running"
        change(completed, "completed")
        assert status() == "running"  # A finished sibling cannot close an active attempt.
        change(active, "failed")
        assert status() == "completed"  # The successful attempt remains available.
        assert change(completed, "running")["ended_at"] is None
        assert status() == "running"
        assert client.delete(f"/api/runs/{completed}", headers=headers).status_code == 204
        assert status() == "failed"
        assert client.delete(f"/api/runs/{active}", headers=headers).status_code == 204
        assert status() == "draft"
        client.patch(f"/api/experiments/{experiment['id']}/status", headers=headers, json={"status": "archived"})
        run("Historical", "completed")
        assert status() == "archived"
