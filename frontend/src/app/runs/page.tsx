"use client";

import { useWorkspaceQuery } from "@/components/providers";

import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, Gauge, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorNotice,
  Field,
  Modal,
  PageHeading,
  StatusBadge,
  SubmitButton,
} from "@/components/ui";
import { api, messageOf } from "@/lib/api";
type Experiment = {
  id: string;
  name: string;
  project_id: string;
  project_name: string;
  model_id: string | null;
};
type Version = {
  id: string;
  model_id: string;
  version: string;
  model_name: string;
  project_id: string;
};
type Run = {
  id: string;
  name: string;
  status: string;
  run_type: string;
  experiment_name: string;
  project_name: string;
  model_name: string | null;
  model_version: string | null;
  best_accuracy: number | null;
  metric_count: number;
  started_at: string;
};
const percent = (v: number | null) =>
  v == null ? "—" : `${(v <= 1 ? v * 100 : v).toFixed(2)}%`;
export default function RunsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [experimentId, setExperimentId] = useState("");
  const [metricRun, setMetricRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const { data = [] } = useWorkspaceQuery({
    queryKey: ["runs"],
    queryFn: () => api<Run[]>("/runs"),
  });
  const { data: experiments = [] } = useWorkspaceQuery({
    queryKey: ["experiments"],
    enabled: open,
    queryFn: () => api<Experiment[]>("/experiments"),
  });
  const { data: versions = [] } = useWorkspaceQuery({
    queryKey: ["model-versions"],
    enabled: open,
    queryFn: () => api<Version[]>("/model-versions"),
  });
  const selectedExperiment = experiments.find(
    (experiment) => experiment.id === experimentId,
  );
  const compatibleVersions = versions.filter(
    (version) =>
      selectedExperiment &&
      version.project_id === selectedExperiment.project_id &&
      (!selectedExperiment.model_id ||
        version.model_id === selectedExperiment.model_id),
  );
  const create = useMutation({
    mutationFn: (body: object) =>
      api<Run>("/runs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
    },
    onError: (e) => setError(messageOf(e)),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/runs/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const metric = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api(`/runs/${id}/metrics`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setMetricRun(null);
    },
    onError: (e) => setError(messageOf(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/runs/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["runs"] }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const d = new FormData(e.currentTarget);
    let hyperparameters = {};
    let environment = {};
    try {
      hyperparameters = JSON.parse(String(d.get("hyperparameters") || "{}"));
      environment = JSON.parse(String(d.get("environment") || "{}"));
    } catch {
      setError("Hyperparameters and environment must be valid JSON.");
      return;
    }
    create.mutate({
      experiment_id: d.get("experiment"),
      model_version_id: d.get("version") || null,
      name: d.get("name"),
      run_type: d.get("type"),
      status: "running",
      hyperparameters,
      environment,
      notes: d.get("notes"),
    });
  }
  function submitMetric(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!metricRun) return;
    const d = new FormData(e.currentTarget);
    metric.mutate({
      id: metricRun.id,
      body: {
        name: d.get("name"),
        value: Number(d.get("value")),
        step: d.get("step") ? Number(d.get("step")) : null,
      },
    });
  }
  return (
    <AppShell>
      <PageHeading
        eyebrow="Reproducible attempts"
        title="Runs"
        description="Log exactly what happened in each training, evaluation, or inference attempt—and keep the metrics with it."
        action={() => setOpen(true)}
      />
      <section className="panel list-panel">
        {data.map((run) => (
          <div className="list-row" key={run.id}>
            <div className="list-primary">
              <div className="resource-icon">
                <Activity size={16} />
              </div>
              <div className="list-primary-text">
                <strong>{run.name}</strong>
                <small>
                  {run.experiment_name} · {run.project_name}
                </small>
              </div>
            </div>
            <div className="list-cell">
              <small>Model</small>
              <div>
                {run.model_name
                  ? `${run.model_name} ${run.model_version}`
                  : "Unlinked"}
              </div>
            </div>
            <div className="list-cell">
              <small>Best score</small>
              <div>
                <strong>{percent(run.best_accuracy)}</strong>
              </div>
            </div>
            <div className="list-cell">
              <small>Metrics</small>
              <div>{run.metric_count} readings</div>
            </div>
            <div className="resource-actions">
              <button
                className="icon-button"
                aria-label="Add metric"
                title="Add metric"
                onClick={() => setMetricRun(run)}
              >
                <Gauge size={14} />
              </button>
              <select
                className="mini-select"
                aria-label={`Status of ${run.name}`}
                value={run.status}
                onChange={(e) =>
                  statusMutation.mutate({ id: run.id, status: e.target.value })
                }
              >
                {["queued", "running", "completed", "failed", "cancelled"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
              <StatusBadge value={run.status} />
              <button
                className="danger-button"
                aria-label={`Delete ${run.name}`}
                onClick={() =>
                  confirm(`Delete “${run.name}”?`) && remove.mutate(run.id)
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!data.length && (
          <EmptyState
            title="No runs logged"
            description="Create an experiment first, then log the hyperparameters, environment, outcome, and metrics for every attempt."
            action={() => setOpen(true)}
          />
        )}
      </section>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log a run"
        description="Save the setup now; add metrics during or after the run."
      >
        <form className="modal-form" onSubmit={submit}>
          {error && <ErrorNotice message={error} />}{" "}
          {!experiments.length && (
            <ErrorNotice message="Create an experiment before logging a run." />
          )}
          <Field label="Experiment">
            <select
              name="experiment"
              required
              disabled={!experiments.length}
              value={experimentId}
              onChange={(event) => setExperimentId(event.target.value)}
            >
              <option value="">Choose an experiment</option>
              {experiments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.project_name} / {e.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Run name">
              <input
                name="name"
                required
                placeholder="vit-randaug-seed42"
                autoFocus
              />
            </Field>
            <Field label="Type">
              <select name="type">
                <option>training</option>
                <option>evaluation</option>
                <option>inference</option>
              </select>
            </Field>
          </div>
          <Field label="Model version">
            <select
              name="version"
              key={experimentId}
              disabled={!selectedExperiment}
            >
              <option value="">No version linked</option>
              {compatibleVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.model_name} · {v.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hyperparameters (JSON)">
            <textarea
              name="hyperparameters"
              defaultValue={
                '{\n  "learning_rate": 0.001,\n  "batch_size": 32\n}'
              }
            />
          </Field>
          <Field label="Environment (JSON)">
            <textarea
              name="environment"
              defaultValue={'{\n  "device": "mps",\n  "seed": 42\n}'}
            />
          </Field>
          <Field label="Notes">
            <textarea
              name="notes"
              placeholder="Anything important about this attempt"
            />
          </Field>
          <SubmitButton pending={create.isPending}>Start run</SubmitButton>
        </form>
      </Modal>
      <Modal
        open={!!metricRun}
        onClose={() => setMetricRun(null)}
        title={`Log metric for ${metricRun?.name || "run"}`}
      >
        <form className="modal-form" onSubmit={submitMetric}>
          {error && <ErrorNotice message={error} />}
          <div className="form-grid">
            <Field label="Metric name">
              <input
                name="name"
                list="metric-names"
                required
                placeholder="val_accuracy"
              />
              <datalist id="metric-names">
                <option value="accuracy" />
                <option value="val_accuracy" />
                <option value="train_loss" />
                <option value="val_loss" />
                <option value="f1" />
                <option value="precision" />
                <option value="recall" />
              </datalist>
            </Field>
            <Field label="Value">
              <input name="value" type="number" step="any" required />
            </Field>
          </div>
          <Field label="Step / epoch">
            <input name="step" type="number" min="0" placeholder="Optional" />
          </Field>
          <SubmitButton pending={metric.isPending}>Log metric</SubmitButton>
        </form>
      </Modal>
    </AppShell>
  );
}
