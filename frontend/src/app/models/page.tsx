"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, GitBranch, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  CardSkeleton,
  EmptyState,
  ErrorNotice,
  Field,
  Modal,
  PageHeading,
  StatusBadge,
  SubmitButton,
} from "@/components/ui";
import { api, messageOf } from "@/lib/api";
type Project = { id: string; name: string };
type Model = {
  id: string;
  name: string;
  framework: string;
  task_type: string;
  status: string;
  description: string;
  project_name: string;
  versions: number;
};
export default function ModelsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [versionFor, setVersionFor] = useState<Model | null>(null);
  const [error, setError] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["models"],
    queryFn: () => api<Model[]>("/models"),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/projects"),
  });
  const create = useMutation({
    mutationFn: (body: object) =>
      api<Model>("/models", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
    },
    onError: (e) => setError(messageOf(e)),
  });
  const addVersion = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api(`/models/${id}/versions`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["models"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setVersionFor(null);
    },
    onError: (e) => setError(messageOf(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/models/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["models"] }),
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const d = new FormData(e.currentTarget);
    create.mutate({
      project_id: d.get("project"),
      name: d.get("name"),
      framework: d.get("framework"),
      task_type: d.get("task"),
      status: d.get("status"),
      repository_url: d.get("repo"),
      description: d.get("description"),
    });
  }
  function submitVersion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!versionFor) return;
    setError("");
    const d = new FormData(e.currentTarget);
    addVersion.mutate({
      id: versionFor.id,
      body: {
        version: d.get("version"),
        stage: d.get("stage"),
        artifact_uri: d.get("artifact"),
        parameters_count: d.get("params") ? Number(d.get("params")) : null,
        notes: d.get("notes"),
      },
    });
  }
  return (
    <AppShell>
      <PageHeading
        eyebrow="Model registry"
        title="Models"
        description="Give every architecture a stable identity, then track immutable versions as it evolves."
        action={() => setOpen(true)}
      />
      {isLoading ? (
        <CardSkeleton />
      ) : (
        <div className="resource-grid">
          {data.map((model) => (
            <article className="resource-card" key={model.id}>
              <div className="resource-card-top">
                <div className="resource-icon">
                  <BrainCircuit size={18} />
                </div>
                <div className="resource-actions">
                  <button
                    className="icon-button"
                    title="Add version"
                    onClick={() => setVersionFor(model)}
                  >
                    <GitBranch size={14} />
                  </button>
                  <button
                    className="danger-button"
                    onClick={() =>
                      confirm(`Delete “${model.name}”?`) &&
                      remove.mutate(model.id)
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <h3>{model.name}</h3>
              <p className="resource-description">
                {model.description ||
                  `${model.task_type} model built with ${model.framework}.`}
              </p>
              <div className="resource-meta">
                <span>{model.project_name}</span>
                <span>{model.framework}</span>
                <span>{model.versions} versions</span>
                <StatusBadge value={model.status} />
              </div>
            </article>
          ))}
          {!data.length && (
            <EmptyState
              title="Register your first model"
              description="A model is the durable identity; versions point to specific weights and artifacts."
              action={() => setOpen(true)}
            />
          )}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Register model">
        <form className="modal-form" onSubmit={submit}>
          {error && <ErrorNotice message={error} />}
          <Field label="Project">
            <select name="project" required>
              <option value="">Choose a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model name">
            <input
              name="name"
              required
              placeholder="Vision Transformer"
              autoFocus
            />
          </Field>
          <div className="form-grid">
            <Field label="Framework">
              <select name="framework" defaultValue="PyTorch">
                {[
                  "PyTorch",
                  "TensorFlow",
                  "JAX",
                  "scikit-learn",
                  "XGBoost",
                  "Transformers",
                  "Other",
                ].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="Task">
              <input name="task" placeholder="Image classification" required />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Lifecycle status">
              <select name="status" defaultValue="development">
                <option>development</option>
                <option>staging</option>
                <option>production</option>
                <option>archived</option>
              </select>
            </Field>
            <Field label="Repository URL">
              <input
                name="repo"
                type="url"
                placeholder="https://github.com/…"
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              name="description"
              placeholder="Architecture, intended use, and constraints"
            />
          </Field>
          <SubmitButton pending={create.isPending}>Register model</SubmitButton>
        </form>
      </Modal>
      <Modal
        open={!!versionFor}
        onClose={() => setVersionFor(null)}
        title={`Add version to ${versionFor?.name || "model"}`}
        description="Point to one immutable set of weights or artifact."
      >
        <form className="modal-form" onSubmit={submitVersion}>
          {error && <ErrorNotice message={error} />}
          <div className="form-grid">
            <Field label="Version">
              <input name="version" required placeholder="v1.0.0" autoFocus />
            </Field>
            <Field label="Stage">
              <select name="stage">
                <option>candidate</option>
                <option>staging</option>
                <option>production</option>
                <option>archived</option>
              </select>
            </Field>
          </div>
          <Field label="Artifact URI">
            <input name="artifact" placeholder="hf://org/model or s3://…" />
          </Field>
          <Field label="Parameter count">
            <input name="params" type="number" min="0" placeholder="Optional" />
          </Field>
          <Field label="Notes">
            <textarea
              name="notes"
              placeholder="What changed in this version?"
            />
          </Field>
          <SubmitButton pending={addVersion.isPending}>
            Save version
          </SubmitButton>
        </form>
      </Modal>
    </AppShell>
  );
}
