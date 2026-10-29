"""Notebook-friendly logging without third-party runtime dependencies."""
from __future__ import annotations

import json
import math
import os
import platform
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, quote
from urllib.request import Request, HTTPRedirectHandler, build_opener

__all__ = ["Client", "ModelLabError"]


class ModelLabError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class _NoRedirect(HTTPRedirectHandler):
    # Never forward an API credential to a redirect destination.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, base_url: str | None = None, token: str | None = None, *, timeout: float = 60):
        self.base_url = (base_url or os.getenv("MODEL_LAB_URL", "")).rstrip("/")
        self._token = token or os.getenv("MODEL_LAB_TOKEN", "")
        parsed = urlparse(self.base_url)
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (parsed.scheme != "https" and not (parsed.scheme == "http" and local)) or not parsed.hostname:
            raise ValueError("Use an HTTPS workspace URL, or HTTP on localhost for development")
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("Use the workspace origin without credentials, path, query, or fragment")
        if not self._token:
            raise ValueError("Set MODEL_LAB_TOKEN or supply a scoped API token from Settings")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be positive and finite")
        self.timeout = timeout
        self._opener = build_opener(_NoRedirect())

    def __repr__(self) -> str:
        return f"Client(base_url={self.base_url!r})"

    def _request(self, method: str, path: str, body: Any = None, *, retry_safe: bool = False) -> Any:
        payload = None if body is None else json.dumps(body, allow_nan=False, separators=(",", ":")).encode()
        for attempt in range(3 if retry_safe else 1):
            request = Request(self.base_url + "/api" + path, data=payload, method=method, headers={
                "Authorization": "Bearer " + self._token,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "model-lab-client/1.1.0",
            })
            try:
                with self._opener.open(request, timeout=self.timeout) as response:
                    raw = response.read()
                    return json.loads(raw) if raw else None
            except HTTPError as exc:
                if retry_safe and exc.code in {429, 502, 503, 504} and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                try:
                    detail = json.loads(exc.read()).get("detail")
                except (ValueError, AttributeError):
                    detail = None
                raise ModelLabError(detail if isinstance(detail, str) else f"Model Lab request failed ({exc.code})", exc.code) from None
            except (URLError, TimeoutError, ConnectionError, OSError):
                if retry_safe and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise ModelLabError("Could not reach Model Lab; check connectivity and the workspace URL") from None
            except (ValueError, UnicodeDecodeError):
                raise ModelLabError("Model Lab returned an invalid response") from None

    def start_run(self, experiment_id: str, name: str, *, model_version_id: str | None = None,
                  hyperparameters: Mapping[str, Any] | None = None,
                  environment: Mapping[str, Any] | None = None,
                  provenance: Mapping[str, Any] | None = None,
                  parent_run_id: str | None = None, notes: str = "") -> dict[str, Any]:
        """Create a run once. Creation is never retried automatically."""
        captured = {"python": platform.python_version(), "platform": platform.system()}
        captured.update(environment or {})
        return self._request("POST", "/runs", {
            "experiment_id": experiment_id, "name": name,
            "model_version_id": model_version_id, "hyperparameters": dict(hyperparameters or {}),
            "environment": captured, "provenance": dict(provenance or {}),
            "parent_run_id": parent_run_id, "notes": notes, "status": "running",
        })

    def log_metrics(self, run_id: str, metrics: Mapping[str, float], *, step: int | None = None,
                    split: str = "", unit: str = "", idempotency_key: str | None = None) -> dict[str, Any]:
        """Atomically log a batch. Retries reuse a key, preventing duplicate readings.

        Persist and reuse idempotency_key when retrying after restarting a notebook.
        Empty split/unit inherit the experiment policy on the server.
        """
        if not metrics:
            raise ValueError("Supply at least one metric")
        if step is not None and (isinstance(step, bool) or not isinstance(step, int) or step < 0):
            raise ValueError("step must be a nonnegative integer")
        rows = []
        for name, value in metrics.items():
            if not isinstance(name, str) or not name.strip():
                raise ValueError("Metric names cannot be empty")
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("Metric values must be finite numbers")
            rows.append({"name": name, "value": value, "step": step, "split": split, "unit": unit})
        return self._request("POST", "/runs/" + quote(run_id, safe="") + "/metrics/batch", {
            "metrics": rows, "idempotency_key": idempotency_key or uuid.uuid4().hex,
        }, retry_safe=True)

    def log_metric(self, run_id: str, name: str, value: float, **kwargs: Any) -> dict[str, Any]:
        return self.log_metrics(run_id, {name: value}, **kwargs)

    def finish_run(self, run_id: str, status: str = "completed") -> dict[str, Any]:
        if status not in {"completed", "failed", "cancelled"}:
            raise ValueError("Finish with completed, failed, or cancelled")
        return self._request("PATCH", "/runs/" + quote(run_id, safe="") + "/status", {"status": status})

    @contextmanager
    def run(self, experiment_id: str, name: str, **kwargs: Any) -> Iterator[dict[str, Any]]:
        """Record a training attempt and its terminal state without uploading secrets."""
        record = self.start_run(experiment_id, name, **kwargs)
        try:
            yield record
        except BaseException:
            try:
                self.finish_run(record["id"], "failed")
            except ModelLabError:
                pass  # Preserve the original training failure.
            raise
        else:
            self.finish_run(record["id"])
