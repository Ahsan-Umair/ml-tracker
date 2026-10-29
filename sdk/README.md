# Model Lab Python client

Install from this repository with `pip install ./sdk`. There are no third-party runtime dependencies.

Create a project-scoped token in Model Lab Settings. Use `write` for creating and completing runs; a `metrics:write` token can only log metrics for existing runs. Keep tokens in your environment or notebook secret store, not source code.

Set `MODEL_LAB_URL` to your frontend origin and `MODEL_LAB_TOKEN` privately. Then:

```python
from model_lab import Client

lab = Client()  # Reads MODEL_LAB_URL and MODEL_LAB_TOKEN.
with lab.run(
    "exp_your_experiment_id", "baseline-seed42",
    hyperparameters={"learning_rate": 0.001, "seed": 42},
    provenance={"git_commit": "your commit", "dataset_checksum": "sha256:…"},
) as run:
    for epoch in range(10):
        # Replace with your training result.
        validation_loss = 1 / (epoch + 1)
        lab.log_metrics(
            run["id"], {"val_loss": validation_loss}, step=epoch,
            split="validation", unit="number", idempotency_key=f"validation-{epoch}",
        )
```

The context manager completes a successful run or marks a failed attempt. Creation is never retried automatically. Batch metric retries reuse the same idempotency key; explicitly preserve keys if restarting a notebook. Reusing a key with different readings is rejected. Choose the experiment's primary metric, unit, split, and optimization direction before comparing results. Empty `split` and `unit` inherit that policy.

The client accepts HTTPS origins and local HTTP development origins. Redirects are refused so tokens cannot be forwarded to another host. It captures only Python version and operating-system name by default; add reproducibility metadata deliberately. Training stays on your machine.
