import os

os.environ["COOKIE_SECURE"] = "false"
os.environ["FRONTEND_ORIGINS"] = "http://localhost:3000"

from fastapi.testclient import TestClient

from app import database
from app.main import app


def test_complete_personal_model_tracking_flow(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "LOCAL_DB", tmp_path / "model-lab-test.db")
    headers = {"Origin": "http://localhost:3000"}

    with TestClient(app) as client:
        registered = client.post(
            "/api/auth/register",
            headers=headers,
            json={
                "display_name": "Test Researcher",
                "email": "researcher@example.com",
                "password": "a-long-test-passphrase",
            },
        )
        assert registered.status_code == 201
        csrf = registered.json()["csrfToken"]
        write_headers = {**headers, "X-CSRF-Token": csrf}

        project = client.post(
            "/api/projects",
            headers=write_headers,
            json={"name": "Vision Lab", "description": "Image experiments", "color": "#7357F6"},
        )
        assert project.status_code == 201
        project_id = project.json()["id"]

        dataset = client.post(
            "/api/datasets",
            headers=write_headers,
            json={"project_id": project_id, "name": "CIFAR-100", "version": "v1", "format": "image"},
        )
        assert dataset.status_code == 201

        model = client.post(
            "/api/models",
            headers=write_headers,
            json={"project_id": project_id, "name": "Vision Transformer", "framework": "PyTorch", "task_type": "classification"},
        )
        assert model.status_code == 201
        model_id = model.json()["id"]

        version = client.post(
            f"/api/models/{model_id}/versions",
            headers=write_headers,
            json={"version": "v1.0.0", "stage": "candidate", "parameters_count": 86000000},
        )
        assert version.status_code == 201

        experiment = client.post(
            "/api/experiments",
            headers=write_headers,
            json={
                "project_id": project_id,
                "dataset_id": dataset.json()["id"],
                "model_id": model_id,
                "name": "Augmentation ablation",
                "objective": "Measure validation uplift",
            },
        )
        assert experiment.status_code == 201

        run = client.post(
            "/api/runs",
            headers=write_headers,
            json={
                "experiment_id": experiment.json()["id"],
                "model_version_id": version.json()["id"],
                "name": "randaug-seed42",
                "hyperparameters": {"learning_rate": 0.001, "seed": 42},
            },
        )
        assert run.status_code == 201
        run_id = run.json()["id"]

        metric = client.post(
            f"/api/runs/{run_id}/metrics",
            headers=write_headers,
            json={"name": "val_accuracy", "value": 0.948, "step": 25},
        )
        assert metric.status_code == 201

        completed = client.patch(
            f"/api/runs/{run_id}/status",
            headers=write_headers,
            json={"status": "completed"},
        )
        assert completed.status_code == 200
        assert completed.json()["ended_at"] is not None

        dashboard = client.get("/api/dashboard")
        assert dashboard.status_code == 200
        assert dashboard.json()["stats"] == {
            "projects": 1,
            "model_versions": 1,
            "runs": 1,
            "best_accuracy": 0.948,
        }
        assert client.get("/api/leaderboard").json()[0]["rank"] == 1
        assert client.get("/api/analytics").status_code == 200

        no_csrf = client.post(
            "/api/projects",
            headers=headers,
            json={"name": "Should fail", "description": "", "color": "#000000"},
        )
        assert no_csrf.status_code == 403

        logged_out = client.post("/api/auth/logout", headers=write_headers)
        assert logged_out.status_code == 204
        assert client.get("/api/auth/me").status_code == 401
