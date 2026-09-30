"use client";

import { useWorkspaceQuery } from "@/components/providers";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, Database, FlaskConical, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  CardSkeleton,
  EmptyState,
  ErrorNotice,
  Field,
  Modal,
  PageHeading,
  SubmitButton,
} from "@/components/ui";
import { api, messageOf } from "@/lib/api";

type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  experiments: number;
  datasets: number;
  models: number;
  updated_at: string;
};
export default function ProjectsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const { data = [], isLoading } = useWorkspaceQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/projects"),
  });
  const create = useMutation({
    mutationFn: (body: object) =>
      api<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
    },
    onError: (e) => setError(messageOf(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const filtered = useMemo(
    () =>
      data.filter((p) =>
        `${p.name} ${p.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [data, search],
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const d = new FormData(e.currentTarget);
    create.mutate({
      name: d.get("name"),
      description: d.get("description"),
      color: d.get("color"),
    });
  }
  return (
    <AppShell>
      <PageHeading
        eyebrow="Organize the work"
        title="Projects"
        description="Keep each ML goal self-contained with its own models, datasets, experiments, and history."
        action={() => setOpen(true)}
      />
      <div className="resource-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
          />
        </div>
      </div>
      {isLoading ? (
        <CardSkeleton />
      ) : (
        <div className="resource-grid">
          {filtered.map((project) => (
            <article className="resource-card" key={project.id}>
              <div className="resource-card-top">
                <div
                  className="resource-icon"
                  style={{
                    color: project.color,
                    background: `${project.color}18`,
                  }}
                >
                  <Boxes size={18} />
                </div>
                <button
                  className="danger-button"
                  aria-label={`Delete ${project.name}`}
                  onClick={() => {
                    if (
                      confirm(
                        `Delete “${project.name}” and everything inside it?`,
                      )
                    )
                      remove.mutate(project.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <h3>{project.name}</h3>
              <p className="resource-description">
                {project.description || "No description yet."}
              </p>
              <div className="resource-meta">
                <span>
                  <FlaskConical size={11} /> {project.experiments} experiments
                </span>
                <span>
                  <Database size={11} /> {project.datasets} datasets
                </span>
                <span>{project.models} models</span>
              </div>
            </article>
          ))}
          {!filtered.length && (
            <EmptyState
              title={
                search ? "No matching projects" : "Create your first project"
              }
              description={
                search
                  ? "Try a different project name or description."
                  : "Projects keep models, data, experiments, and runs tied to one clear goal."
              }
              action={search ? undefined : () => setOpen(true)}
            />
          )}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New project"
        description="A focused home for one ML problem."
      >
        <form className="modal-form" onSubmit={submit}>
          {error && <ErrorNotice message={error} />}
          <Field label="Project name">
            <input
              name="name"
              required
              maxLength={100}
              placeholder="e.g. Customer churn prediction"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              maxLength={2000}
              placeholder="What are you trying to learn or ship?"
            />
          </Field>
          <Field label="Accent color">
            <input name="color" type="color" defaultValue="#27785F" />
          </Field>
          <SubmitButton pending={create.isPending}>Create project</SubmitButton>
        </form>
      </Modal>
    </AppShell>
  );
}
