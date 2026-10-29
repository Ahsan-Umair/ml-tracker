"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { useWorkspaceQuery } from "@/components/providers";
import {
  ErrorNotice,
  Field,
  Modal,
  StatusBadge,
  SubmitButton,
} from "@/components/ui";
import { ResourceForm } from "./resource-forms";
import { RunMetrics } from "./run-metrics";
import { api, messageOf } from "@/lib/api";
import {
  downloadCsv,
  downloadJson,
  formatBytes,
  formatDate,
  formatMetric,
  resourceLabels,
  type Resource,
  type ResourceKind,
  type Version,
} from "@/lib/workspace";
import styles from "./resource-workspace.module.css";

function Definition({ entries }: { entries: [string, ReactNode][] }) {
  return (
    <dl className={styles.definition}>
      {entries.map(([label, value]) => (
        <div style={{ display: "contents" }} key={label}>
          <dt>{label}</dt>
          <dd>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Reference({ value }: { value?: string }) {
  if (!value) return <>—</>;
  let href = "";
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") href = url.href;
  } catch {
    /* Non-web URIs are displayed as references. */
  }
  if (href)
    return (
      <a
        className={styles.link}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {value} ↗
      </a>
    );
  return <code>{value}</code>;
}

function Related({
  kind,
  projectId,
  experimentId,
}: {
  kind: ResourceKind;
  projectId?: string;
  experimentId?: string;
}) {
  const params = new URLSearchParams({ limit: "6" });
  if (projectId) params.set("project_id", projectId);
  if (experimentId) params.set("experiment_id", experimentId);
  const { data = [], isPending } = useWorkspaceQuery({
    queryKey: [kind, "related", projectId || experimentId || ""],
    queryFn: ({ signal }) => api<Resource[]>(`/${kind}?${params}`, { signal }),
  });
  const target = `/${kind}?${projectId ? `project_id=${projectId}` : `experiment_id=${experimentId}`}`;
  return (
    <section className={`panel ${styles.section}`}>
      <div className={styles.header}>
        <h2>{resourceLabels[kind].title}</h2>
        <Link className={styles.link} href={target}>
          View all / create →
        </Link>
      </div>
      {isPending ? (
        <p role="status">Loading…</p>
      ) : data.length ? (
        <div className={styles.compactList}>
          {data.map((row) => (
            <Link key={row.id} href={`/${kind}/${row.id}`}>
              <strong>{row.name}</strong>
              <span>{row.status || row.framework || row.version}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className={styles.help}>
          None yet.{" "}
          <Link href={target}>
            Create the first {resourceLabels[kind].singular} →
          </Link>
        </p>
      )}
    </section>
  );
}

function VersionHistory({ model }: { model: Resource }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const versions = useWorkspaceQuery({
    queryKey: ["model-versions", model.id],
    queryFn: ({ signal }) =>
      api<Version[]>(`/models/${model.id}/versions?limit=500`, { signal }),
  });
  const create = useMutation({
    mutationFn: (body: object) =>
      api(`/models/${model.id}/versions`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["model-versions"] });
      void qc.invalidateQueries({ queryKey: ["models"] });
      setOpen(false);
    },
    onError: (cause) => setError(messageOf(cause)),
  });
  const promote = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api(`/model-versions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ stage }),
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["model-versions"] }),
    onError: (cause) => setError(messageOf(cause)),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    create.mutate({
      version: form.get("version"),
      stage: form.get("stage"),
      artifact_uri: form.get("artifact_uri"),
      checksum: form.get("checksum"),
      parameters_count: form.get("parameters_count")
        ? Number(form.get("parameters_count"))
        : null,
      notes: form.get("notes"),
    });
  }
  return (
    <section className={`panel ${styles.section}`}>
      <div className={styles.header}>
        <div>
          <h2>Model versions</h2>
          <p className={styles.help}>
            Immutable version names, artifact references, and lifecycle stages.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          Register version
        </button>
      </div>
      {error && !open && <ErrorNotice message={error} />}
      {versions.isPending && <p role="status">Loading versions…</p>}
      <div className={styles.versionList}>
        {versions.data?.map((version) => (
          <article className={styles.version} key={version.id}>
            <div className={styles.versionHeader}>
              <strong>{version.version}</strong>
              <label className={styles.check}>
                Stage
                <select
                  aria-label={`Stage of ${version.version}`}
                  value={version.stage}
                  disabled={promote.isPending}
                  onChange={(event) =>
                    promote.mutate({
                      id: version.id,
                      stage: event.target.value,
                    })
                  }
                >
                  {["candidate", "staging", "production", "archived"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <p className={styles.help}>
              {formatDate(version.created_at)}
              {version.parameters_count != null
                ? ` · ${version.parameters_count.toLocaleString()} parameters`
                : ""}
            </p>
            <p>
              <Reference value={version.artifact_uri} />
            </p>
            {version.checksum && (
              <p className={styles.help}>
                Checksum: <code>{version.checksum}</code>
              </p>
            )}
            {version.notes && <p className={styles.summary}>{version.notes}</p>}
          </article>
        ))}
      </div>
      {!versions.isPending && !versions.data?.length && (
        <p className={styles.notice}>
          Register a first version, then link it when logging a run.
        </p>
      )}
      <Modal
        title={`Register version of ${model.name}`}
        open={open}
        pending={create.isPending}
        onClose={() => setOpen(false)}
      >
        <form className="modal-form" onSubmit={submit}>
          {error && <ErrorNotice message={error} />}
          <div className="form-grid">
            <Field label="Version">
              <input
                name="version"
                maxLength={40}
                required
                placeholder="v1.0.0"
              />
            </Field>
            <Field label="Stage">
              <select name="stage">
                {["candidate", "staging", "production", "archived"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <Field
            label="Artifact URI"
            hint="Store the artifact externally and record its location here."
          >
            <input
              name="artifact_uri"
              maxLength={2000}
              placeholder="https://… or s3://…"
            />
          </Field>
          <Field label="Artifact checksum">
            <input name="checksum" maxLength={256} />
          </Field>
          <Field label="Parameter count">
            <input name="parameters_count" type="number" min="0" step="1" />
          </Field>
          <Field label="Version notes">
            <textarea name="notes" maxLength={4000} rows={3} />
          </Field>
          <SubmitButton pending={create.isPending}>
            Register version
          </SubmitButton>
        </form>
      </Modal>
    </section>
  );
}

export function ResourceDetail({
  kind,
  id,
}: {
  kind: ResourceKind;
  id: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [actionError, setActionError] = useState("");
  const [exporting, setExporting] = useState(false);
  const labels = resourceLabels[kind];
  const query = useWorkspaceQuery({
    queryKey: [kind, id],
    queryFn: ({ signal }) => api<Resource>(`/${kind}/${id}`, { signal }),
  });
  const preview = useWorkspaceQuery({
    queryKey: [kind, id, "deletion-preview"],
    enabled: deleting,
    queryFn: ({ signal }) =>
      api<{ counts: Record<string, number>; total: number }>(
        `/${kind}/${id}/deletion-preview`,
        { signal },
      ),
  });
  const change = useMutation({
    mutationFn: (body: object) =>
      api<Resource>(
        `/${kind}/${id}${kind === "runs" || kind === "experiments" ? "/status" : ""}`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [kind] }),
    onError: (cause) => setActionError(messageOf(cause)),
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/${kind}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries();
      router.push(`/${kind}`);
    },
    onError: (cause) => setActionError(messageOf(cause)),
  });
  const item = query.data;
  async function report() {
    if (!item || exporting) return;
    setExporting(true);
    try {
      setActionError("");
      if (kind === "projects")
        downloadJson(
          `${item.name}-project.json`,
          await api(`/workspace/export?project_id=${id}`),
        );
      else if (kind === "experiments") {
        const runs: Resource[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await api<Resource[]>(
            `/runs?experiment_id=${id}&limit=500&offset=${offset}`,
          );
          runs.push(...page);
          if (page.length < 500) break;
        }
        downloadCsv(
          `${item.name}-results.csv`,
          [
            "run",
            "status",
            "metric",
            "split",
            "unit",
            "direction",
            "aggregation",
            "score",
            "hyperparameters",
            "environment",
            "provenance",
            "notes",
          ],
          runs.map((run) => [
            run.name,
            run.status,
            run.primary_metric,
            run.metric_split,
            run.metric_unit,
            run.metric_direction,
            run.metric_aggregation,
            run.score,
            run.hyperparameters,
            run.environment,
            run.provenance,
            run.notes,
          ]),
        );
      } else downloadJson(`${item.name}.json`, item);
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setExporting(false);
    }
  }
  return (
    <AppShell>
      <p className={styles.crumb}>
        <Link href={`/${kind}`}>{labels.title}</Link> /{" "}
        {item?.name || "Details"}
      </p>
      {query.isPending && <p role="status">Loading {labels.singular}…</p>}
      {query.isError && <ErrorNotice message={messageOf(query.error)} />}
      {item && (
        <div className={styles.detail}>
          <div className={styles.header}>
            <div>
              <p className="eyebrow">{labels.singular}</p>
              <h1>{item.name}</h1>
              <div className={styles.statusRow}>
                {item.status && <StatusBadge value={item.status} />}
                {item.archived && <StatusBadge value="archived" />}
                {item.project_id && (
                  <Link
                    className={styles.link}
                    href={`/projects/${item.project_id}`}
                  >
                    {item.project_name || "Open project"} →
                  </Link>
                )}
                {item.experiment_id && (
                  <Link
                    className={styles.link}
                    href={`/experiments/${item.experiment_id}`}
                  >
                    {item.experiment_name || "Open experiment"} →
                  </Link>
                )}
              </div>
            </div>
            <div className={styles.actions}>
              <button className="primary-button" onClick={() => setEdit(true)}>
                Edit {labels.singular}
              </button>
              <button
                className="secondary-button"
                disabled={exporting}
                onClick={() => void report()}
              >
                {exporting
                  ? "Exporting…"
                  : kind === "experiments"
                    ? "Export results CSV"
                    : "Export JSON"}
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setActionError("");
                  setConfirmation("");
                  setDeleting(true);
                }}
              >
                Delete
              </button>
            </div>
          </div>
          {actionError && !deleting && <ErrorNotice message={actionError} />}
          {!!item.tags?.length && (
            <div className={styles.tags}>
              {item.tags.map((tag) => (
                <span className={styles.tag} key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className={styles.detailGrid}>
            <section className={`panel ${styles.section}`}>
              <h2>Overview</h2>
              {item.description && (
                <p className={styles.summary}>{item.description}</p>
              )}
              {item.objective && (
                <p className={styles.notice}>{item.objective}</p>
              )}
              <Definition
                entries={[
                  ["Created", formatDate(item.created_at)],
                  ["Updated", formatDate(item.updated_at)],
                  ...(kind === "datasets"
                    ? ([
                        ["Version", item.version],
                        ["Format", item.format],
                        ["Size", formatBytes(item.size_bytes)],
                        ["Rows / samples", item.row_count?.toLocaleString()],
                        ["Location", <Reference key="uri" value={item.uri} />],
                        ["Checksum", item.checksum],
                      ] as [string, ReactNode][])
                    : []),
                  ...(kind === "models"
                    ? ([
                        ["Framework", item.framework],
                        ["Task", item.task_type],
                        [
                          "Repository",
                          <Reference key="repo" value={item.repository_url} />,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  ...(kind === "runs"
                    ? ([
                        ["Run type", item.run_type],
                        [
                          "Model version",
                          item.model_name
                            ? `${item.model_name} · ${item.model_version}`
                            : "Unlinked",
                        ],
                        ["Started", formatDate(item.started_at)],
                        ["Ended", formatDate(item.ended_at)],
                        [
                          "Parent run",
                          item.parent_run_id ? (
                            <Link
                              key="parent"
                              className={styles.link}
                              href={`/runs/${item.parent_run_id}`}
                            >
                              Open parent run →
                            </Link>
                          ) : (
                            "—"
                          ),
                        ],
                      ] as [string, ReactNode][])
                    : []),
                ]}
              />
            </section>
            <section className={`panel ${styles.section}`}>
              <h2>
                {kind === "experiments" || kind === "runs"
                  ? "Evaluation protocol"
                  : "Lifecycle"}
              </h2>
              {item.metric_policy_confirmed === false && (
                <p className={styles.notice} role="status">
                  Historical readings need a protocol review. Scores and
                  rankings are hidden until you verify their metric, split,
                  unit, direction, and aggregation.{" "}
                  {kind === "experiments" ? (
                    <button
                      className="secondary-button"
                      onClick={() => setEdit(true)}
                    >
                      Review evaluation protocol
                    </button>
                  ) : item.experiment_id ? (
                    <Link
                      className={styles.link}
                      href={`/experiments/${item.experiment_id}`}
                    >
                      Review the experiment protocol →
                    </Link>
                  ) : null}
                </p>
              )}
              {(kind === "experiments" || kind === "runs") && (
                <>
                  <Definition
                    entries={[
                      ["Primary metric", item.primary_metric],
                      ["Evaluation split", item.metric_split],
                      ["Unit", item.metric_unit],
                      [
                        "Direction",
                        item.metric_direction === "min"
                          ? "Lower is better"
                          : "Higher is better",
                      ],
                      [
                        "Aggregation",
                        item.metric_aggregation === "final"
                          ? "Final reading"
                          : "Best reading",
                      ],
                      ...(kind === "runs"
                        ? ([
                            [
                              "Primary score",
                              formatMetric(item.score, item.metric_unit),
                            ],
                          ] as [string, ReactNode][])
                        : []),
                    ]}
                  />
                  <p className={styles.help}>
                    Only readings matching the experiment metric, split, and
                    unit contribute to this score.
                  </p>
                </>
              )}
              {kind === "runs" && (
                <Field label="Run status">
                  <select
                    value={item.status}
                    disabled={change.isPending}
                    onChange={(event) =>
                      change.mutate({ status: event.target.value })
                    }
                  >
                    {[
                      "queued",
                      "running",
                      "completed",
                      "failed",
                      "cancelled",
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
              )}
              {kind === "projects" && (
                <>
                  <p className={styles.help}>
                    Archive finished work to preserve its models, datasets, and
                    history.
                  </p>
                  <button
                    className="secondary-button"
                    disabled={change.isPending}
                    onClick={() => change.mutate({ archived: !item.archived })}
                  >
                    {item.archived ? "Restore project" : "Archive project"}
                  </button>
                </>
              )}
              {kind === "experiments" && (
                <button
                  className="secondary-button"
                  disabled={change.isPending}
                  onClick={() =>
                    change.mutate({
                      status: item.status === "archived" ? "draft" : "archived",
                    })
                  }
                >
                  {item.status === "archived"
                    ? "Unarchive experiment"
                    : "Archive experiment"}
                </button>
              )}
              {kind === "models" && (
                <Field label="Model lifecycle">
                  <select
                    value={item.status}
                    disabled={change.isPending}
                    onChange={(event) =>
                      change.mutate({ status: event.target.value })
                    }
                  >
                    {["development", "staging", "production", "archived"].map(
                      (value) => (
                        <option key={value}>{value}</option>
                      ),
                    )}
                  </select>
                </Field>
              )}
              {kind === "datasets" && (
                <p className={styles.help}>
                  This registry stores a dataset reference. Keep its content
                  available at the recorded URI, and use a checksum to identify
                  the exact data.
                </p>
              )}
            </section>
          </div>
          {kind === "runs" && (
            <>
              <div className={styles.detailGrid}>
                {(
                  ["hyperparameters", "environment", "provenance"] as const
                ).map((field) => (
                  <section className={`panel ${styles.section}`} key={field}>
                    <h2>{field[0].toUpperCase() + field.slice(1)}</h2>
                    <pre className={styles.code}>
                      {JSON.stringify(item[field] || {}, null, 2)}
                    </pre>
                  </section>
                ))}
                {item.notes && (
                  <section className={`panel ${styles.section}`}>
                    <h2>Run notes</h2>
                    <p className={styles.summary}>{item.notes}</p>
                  </section>
                )}
              </div>
              <RunMetrics run={item} />
              <Link className={styles.link} href={`/runs/compare?ids=${id}`}>
                Compare with another run →
              </Link>
            </>
          )}
          {kind === "models" && <VersionHistory model={item} />}
          {kind === "projects" && (
            <>
              <div className={styles.detailGrid}>
                <Related kind="models" projectId={id} />
                <Related kind="datasets" projectId={id} />
              </div>
              <Related kind="experiments" projectId={id} />
            </>
          )}
          {kind === "experiments" && <Related kind="runs" experimentId={id} />}
          <Modal
            title={`Edit ${labels.singular}`}
            open={edit}
            pending={pending}
            onClose={() => setEdit(false)}
          >
            <ResourceForm
              kind={kind}
              item={item}
              onPendingChange={setPending}
              onSaved={() => setEdit(false)}
            />
          </Modal>
          <Modal
            title={`Delete ${item.name}?`}
            open={deleting}
            pending={remove.isPending}
            protectDraft={false}
            onClose={() => setDeleting(false)}
          >
            {actionError && <ErrorNotice message={actionError} />}
            <p className={styles.notice}>
              This permanently deletes this {labels.singular}.{" "}
              {kind === "projects" || kind === "experiments"
                ? "Archiving preserves history and is usually safer."
                : "Export a copy first if you may need it later."}
            </p>
            {preview.isPending && (
              <p role="status">Checking affected records…</p>
            )}
            {preview.isError && (
              <ErrorNotice message={messageOf(preview.error)} />
            )}
            {preview.data && (
              <>
                <p>The following linked records will also be deleted:</p>
                <ul>
                  {Object.entries(preview.data.counts)
                    .filter(([, count]) => count > 0)
                    .map(([name, count]) => (
                      <li key={name}>
                        {count} {name.replaceAll("_", " ")}
                      </li>
                    ))}
                  {preview.data.total === 0 && <li>No dependent records.</li>}
                </ul>
                <Field label={`Type “${item.name}” to confirm`}>
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <div className={styles.actions}>
                  <button
                    className="secondary-button"
                    disabled={exporting}
                    onClick={() => void report()}
                  >
                    {exporting ? "Exporting…" : "Export first"}
                  </button>
                  <button
                    className="primary-button"
                    disabled={confirmation !== item.name || remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? "Deleting…" : "Permanently delete"}
                  </button>
                </div>
              </>
            )}
          </Modal>
        </div>
      )}
    </AppShell>
  );
}
