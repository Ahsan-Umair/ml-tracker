import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from model_lab import Client, ModelLabError


class Response(io.BytesIO):
    pass


class ClientTests(unittest.TestCase):
    def client(self):
        return Client("http://localhost:8000", "private-test-token")

    def test_credential_is_not_exposed_and_insecure_remote_is_rejected(self):
        self.assertNotIn("private-test-token", repr(self.client()))
        for url in ("http://example.com", "https://owner:password@example.com", "https://example.com/api", "https://example.com?token=x"):
            with self.assertRaises(ValueError):
                Client(url, "token")

    def test_batch_retries_reuse_key_and_payload(self):
        client = self.client()
        requests = []
        def send(request, **kwargs):
            requests.append(request)
            if len(requests) == 1:
                raise HTTPError(request.full_url, 503, "unavailable", {}, io.BytesIO(b"{}"))
            return Response(b'{"metrics":[],"replayed":true}')
        with patch.object(client._opener, "open", side_effect=send), patch("model_lab.time.sleep"):
            result = client.log_metrics("run_1", {"val_accuracy": 0.9}, step=2, idempotency_key="epoch-2")
        self.assertTrue(result["replayed"])
        self.assertEqual(requests[0].data, requests[1].data)
        self.assertEqual(json.loads(requests[0].data)["idempotency_key"], "epoch-2")
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer private-test-token")

    def test_run_creation_does_not_retry_ambiguous_failure(self):
        client = self.client()
        with patch.object(client._opener, "open", side_effect=URLError("network")) as send:
            with self.assertRaises(ModelLabError):
                client.start_run("exp_1", "test")
            self.assertEqual(send.call_count, 1)

    def test_failed_training_marks_run_failed_and_preserves_exception(self):
        client = self.client()
        with patch.object(client, "start_run", return_value={"id": "run_1"}), patch.object(client, "finish_run", side_effect=ModelLabError("offline")) as finish:
            with self.assertRaisesRegex(RuntimeError, "training failed"):
                with client.run("exp_1", "test"):
                    raise RuntimeError("training failed")
            finish.assert_called_once_with("run_1", "failed")

    def test_invalid_metrics_are_rejected_before_sending(self):
        for value in (float("nan"), float("inf"), True):
            with self.assertRaises(ValueError):
                self.client().log_metric("run_1", "loss", value)


if __name__ == "__main__":
    unittest.main()
