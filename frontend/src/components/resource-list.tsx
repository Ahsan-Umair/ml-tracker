"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth, useWorkspaceQuery } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { Modal, PageHeading, StatusBadge } from "@/components/ui";
import { ResourceForm } from "./resource-forms";
import { api, messageOf } from "@/lib/api";
import {
  formatBytes,
  formatMetric,
  resourceLabels,
  statusOptions,
  type Resource,
  type ResourceKind,
} from "@/lib/workspace";
import styles from "./resource-workspace.module.css";

type View = {
  name: string;
  query: string;
  status: string;
  project: string;
  experiment: string;
  sort: string;
};
const pageSize = 25;

export function ResourceList({ kind }: { kind: ResourceKind }) {
  const labels = resourceLabels[kind];
  const params = useSearchParams();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState("");
  const [project, setProject] = useState(params.get("project_id") || "");
  const [experiment, setExperiment] = useState(
    params.get("experiment_id") || "",
  );
  const [sort, setSort] = useState("updated_desc");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [viewName, setViewName] = useState("");
  const [viewMessage, setViewMessage] = useState("");
  const search = new URLSearchParams({
    limit: String(pageSize + 1),
    offset: String(page * pageSize),
    sort,
  });
  if (deferredQuery) search.set("q", deferredQuery);
  if (status) search.set("status", status);
  if (project) search.set("project_id", project);
  if (kind === "runs" && experiment) search.set("experiment_id", experiment);
  const request = `/${kind}?${search}`;
  const records = useWorkspaceQuery({
    queryKey: [kind, "list", request],
    queryFn: ({ signal }) => api<Resource[]>(request, { signal }),
  });
  const { data: projects = [] } = useWorkspaceQuery({
    queryKey: ["projects", "filters"],
    enabled: kind !== "projects",
    queryFn: ({ signal }) => api<Resource[]>("/projects?limit=500", { signal }),
  });
  const { data: experiments = [] } = useWorkspaceQuery({
    queryKey: ["experiments", "filters"],
    enabled: kind === "runs",
    queryFn: ({ signal }) =>
      api<Resource[]>("/experiments?limit=500", { signal }),
  });
  const rows = records.data?.slice(0, pageSize) || [];
  const hasNext = (records.data?.length || 0) > pageSize;
  const storageKey = `model-lab:views:v1:${user?.id}:${kind}`;
  function readViews() {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(storageKey) || "[]",
      );
      const valid = Array.isArray(parsed)
        ? parsed
            .filter(
              (item): item is View =>
                item &&
                typeof item === "object" &&
                [
                  "name",
                  "query",
                  "status",
                  "project",
                  "experiment",
                  "sort",
                ].every((key) => typeof item[key] === "string"),
            )
            .slice(0, 20)
        : [];
      setViews(valid);
      return valid;
    } catch {
      setViewMessage("Saved views are unavailable in this browser.");
      return [];
    }
  }
  function saveView() {
    if (!viewName.trim()) {
      setViewMessage("Give this view a name first.");
      return;
    }
    const next = [
      ...readViews().filter((view) => view.name !== viewName.trim()),
      {
        name: viewName.trim().slice(0, 50),
        query,
        status,
        project,
        experiment,
        sort,
      },
    ].slice(-20);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setViews(next);
      setViewName("");
      setViewMessage("View saved on this device.");
    } catch {
      setViewMessage("This browser could not save the view.");
    }
  }
  function loadView(name: string) {
    const view = views.find((item) => item.name === name);
    if (!view) return;
    setQuery(view.query);
    setStatus(view.status);
    setProject(view.project);
    setExperiment(view.experiment);
    setSort(view.sort);
    setPage(0);
  }
  return (
    <AppShell>
      <PageHeading
        eyebrow="Your workspace"
        title={labels.title}
        description={labels.description}
        action={() => setOpen(true)}
        actionLabel={labels.action}
      />
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <input
            aria-label={`Search ${kind}`}
            placeholder="Search names and tags…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          {kind !== "projects" && (
            <select
              aria-label="Filter by project"
              value={project}
              onChange={(event) => {
                setProject(event.target.value);
                setExperiment("");
                setPage(0);
              }}
            >
              <option value="">All projects</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          {kind === "runs" && (
            <select
              aria-label="Filter by experiment"
              value={experiment}
              onChange={(event) => {
                setExperiment(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All experiments</option>
              {experiments
                .filter((item) => !project || item.project_id === project)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          )}
          {!!statusOptions[kind].length && (
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All statuses</option>
              {statusOptions[kind].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          )}
          <select
            aria-label="Sort records"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(0);
            }}
          >
            <option value="updated_desc">Recently updated</option>
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
          </select>
        </div>
      </div>
      <details
        className={`${styles.notice} ${styles.saved}`}
        onToggle={(event) => {
          if (event.currentTarget.open) readViews();
        }}
      >
        <summary>Saved views</summary>
        <div className={styles.saved}>
          <select
            aria-label="Load saved view"
            defaultValue=""
            onChange={(event) => loadView(event.target.value)}
          >
            <option value="">Choose a saved view</option>
            {views.map((view) => (
              <option key={view.name}>{view.name}</option>
            ))}
          </select>
          <input
            aria-label="New view name"
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            placeholder="View name"
            maxLength={50}
          />
          <button type="button" className="secondary-button" onClick={saveView}>
            Save current filters
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              try {
                localStorage.removeItem(storageKey);
                setViews([]);
                setViewMessage("Saved views cleared.");
              } catch {
                setViewMessage("Could not clear saved views.");
              }
            }}
          >
            Clear saved views
          </button>
        </div>
        <p role="status" className={styles.help}>
          {viewMessage ||
            "Views are stored only on this device, separately for each account."}
        </p>
      </details>
      {records.isError && (
        <div className={`${styles.notice} ${styles.error}`} role="alert">
          {messageOf(records.error)}{" "}
          <button
            className="secondary-button"
            onClick={() => void records.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {records.isPending && <p role="status">Loading {kind}…</p>}
      <div className={styles.grid} aria-busy={records.isFetching}>
        {rows.map((item) => (
          <article key={item.id} className={`panel ${styles.card}`}>
            <div className={styles.statusRow}>
              {item.status && <StatusBadge value={item.status} />}
              {item.archived && <StatusBadge value="archived" />}
              {kind === "runs" && (
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    disabled={
                      !selected.includes(item.id) && selected.length >= 4
                    }
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                  />
                  Compare
                </label>
              )}
            </div>
            <h2>
              <Link href={`/${kind}/${item.id}`}>{item.name}</Link>
            </h2>
            <p className={styles.help}>
              {item.experiment_name ||
                item.project_name ||
                (kind === "projects" ? "Project workspace" : "")}
            </p>
            {item.description && (
              <p className={styles.summary}>
                {item.description.length > 180
                  ? `${item.description.slice(0, 180)}…`
                  : item.description}
              </p>
            )}
            <dl className={styles.meta}>
              {kind === "projects" && (
                <>
                  <div>
                    <dt>Models</dt>
                    <dd>{item.models ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Experiments</dt>
                    <dd>{item.experiments ?? 0}</dd>
                  </div>
                </>
              )}
              {kind === "datasets" && (
                <>
                  <div>
                    <dt>Version / format</dt>
                    <dd>
                      {item.version} · {item.format}
                    </dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(item.size_bytes)}</dd>
                  </div>
                </>
              )}
              {kind === "models" && (
                <>
                  <div>
                    <dt>Framework</dt>
                    <dd>{item.framework}</dd>
                  </div>
                  <div>
                    <dt>Versions</dt>
                    <dd>{item.versions ?? 0}</dd>
                  </div>
                </>
              )}
              {kind === "experiments" && (
                <>
                  <div>
                    <dt>Primary metric</dt>
                    <dd>{item.primary_metric}</dd>
                  </div>
                  <div>
                    <dt>Runs</dt>
                    <dd>{item.runs ?? 0}</dd>
                  </div>
                </>
              )}
              {kind === "runs" && (
                <>
                  <div>
                    <dt>{item.primary_metric || "Primary score"}</dt>
                    <dd className={styles.metricValue}>
                      {formatMetric(
                        item.metric_policy_confirmed === false
                          ? null
                          : item.score,
                        item.metric_unit,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Readings</dt>
                    <dd>{item.metric_count ?? 0}</dd>
                  </div>
                </>
              )}
            </dl>
            {!!item.tags?.length && (
              <div className={styles.tags}>
                {item.tags.map((tag) => (
                  <span className={styles.tag} key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {item.metric_policy_confirmed === false && (
              <p className={styles.notice}>
                Historical results need protocol review before scoring.{" "}
                <Link
                  className={styles.link}
                  href={`/experiments/${kind === "experiments" ? item.id : item.experiment_id}`}
                >
                  Review protocol →
                </Link>
              </p>
            )}
            <div className={styles.cardFooter}>
              <Link className={styles.link} href={`/${kind}/${item.id}`}>
                Open {labels.singular} →
              </Link>
              {kind === "experiments" && (
                <small className={styles.muted}>
                  {item.metric_direction === "min" ? "Lower" : "Higher"} is
                  better
                </small>
              )}
            </div>
          </article>
        ))}
      </div>
      {!records.isPending && !records.isError && !rows.length && (
        <div className={`panel ${styles.empty}`}>
          <h2>
            {query || status || project || experiment
              ? "No matching records"
              : `No ${kind} yet`}
          </h2>
          <p className={styles.help}>
            Adjust the filters or {labels.action.toLowerCase()} to get started.
          </p>
          <button className="primary-button" onClick={() => setOpen(true)}>
            {labels.action}
          </button>
        </div>
      )}
      <div className={styles.pagination}>
        <button
          className="secondary-button"
          disabled={page === 0 || records.isFetching}
          onClick={() => setPage((current) => current - 1)}
        >
          ← Previous
        </button>
        <span>
          Page {page + 1} · {rows.length} records
        </span>
        <button
          className="secondary-button"
          disabled={!hasNext || records.isFetching}
          onClick={() => setPage((current) => current + 1)}
        >
          Next →
        </button>
      </div>
      {kind === "runs" && selected.length > 0 && (
        <div className={`panel ${styles.compareSticky}`}>
          <span>{selected.length} of 4 runs selected</span>
          <div className={styles.actions}>
            <button
              className="secondary-button"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
            <Link
              className="primary-button"
              href={`/runs/compare?ids=${selected.join(",")}`}
            >
              Compare selected runs →
            </Link>
          </div>
        </div>
      )}
      <Modal
        title={labels.action}
        open={open}
        pending={pending}
        onClose={() => setOpen(false)}
      >
        <ResourceForm
          kind={kind}
          initialProject={project}
          initialExperiment={experiment}
          onPendingChange={setPending}
          onSaved={() => setOpen(false)}
        />
      </Modal>
    </AppShell>
  );
}
