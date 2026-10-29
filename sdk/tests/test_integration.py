"""Opt-in end-to-end SDK check against disposable localhost data only."""
import http.cookiejar
import json
import os
import secrets
import unittest
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPCookieProcessor

from model_lab import Client, ModelLabError


@unittest.skipUnless(os.getenv("MODEL_LAB_INTEGRATION_URL"), "Requires disposable localhost servers")
class NotebookIntegrationTests(unittest.TestCase):
    def test_notebook_logging_through_frontend_proxy_and_token_revocation(self):
        origin = os.environ["MODEL_LAB_INTEGRATION_URL"].rstrip("/")
        if urlparse(origin).hostname not in {"localhost", "127.0.0.1", "::1"}:
            self.fail("Integration checks must use a disposable localhost environment")
        opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        password = secrets.token_urlsafe(24)
        csrf = ""

        def api(method, path, data=None):
            request = Request(origin + "/api" + path, method=method,
                              data=None if data is None else json.dumps(data).encode(),
                              headers={"Content-Type": "application/json", "Origin": origin, "X-CSRF-Token": csrf})
            with opener.open(request, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else None

        account = api("POST", "/auth/register", {"display_name": "Notebook integration", "email": secrets.token_hex(8) + "@example.com", "password": password})
        csrf = account["csrfToken"]
        project = api("POST", "/projects", {"name": "SDK integration"})
        experiment = api("POST", "/experiments", {"project_id": project["id"], "name": "Validation loss", "primary_metric": "val_loss", "metric_direction": "min", "metric_unit": "number"})
        credential = api("POST", "/auth/tokens", {"name": "Notebook", "password": password, "project_id": project["id"], "scopes": ["write"]})
        lab = Client(origin, credential["token"])
        with lab.run(experiment["id"], "seed42", hyperparameters={"seed": 42}) as run:
            lab.log_metric(run["id"], "val_loss", 0.25, step=1, idempotency_key="validation-1")
            replay = lab.log_metric(run["id"], "val_loss", 0.25, step=1, idempotency_key="validation-1")
            self.assertTrue(replay["replayed"])
        saved = api("GET", "/runs/" + run["id"])
        self.assertEqual(saved["status"], "completed")
        self.assertEqual(saved["score"], 0.25)
        self.assertEqual(saved["metric_count"], 1)
        api("POST", "/auth/password", {"current_password": password, "password": secrets.token_urlsafe(24)})
        with self.assertRaises(ModelLabError) as revoked:
            lab.finish_run(run["id"])
        self.assertEqual(revoked.exception.status, 401)
