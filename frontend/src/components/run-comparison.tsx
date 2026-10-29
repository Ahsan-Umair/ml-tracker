"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "./app-shell";
import { useWorkspaceQuery } from "./providers";
import { ErrorNotice, PageHeading, StatusBadge } from "./ui";
import { MetricCurve } from "./run-metrics";
import { api, messageOf } from "@/lib/api";
import {
  downloadCsv,
  formatDate,
  formatMetric,
  metricMatches,
  sameEvaluation,
  type Metric,
  type Resource,
} from "@/lib/workspace";
import styles from "./resource-workspace.module.css";

export function RunComparison() {
  const params = useSearchParams();
  const [ids, setIds] = useState(() =>
    [
      ...new Set(
        (params.get("ids") || "")
          .split(",")
          .filter((id) => /^run_[a-f0-9]+$/.test(id)),
      ),
    ].slice(0, 4),
  );
  const [candidate, setCandidate] = useState("");
  const options = useWorkspaceQuery({
    queryKey: ["runs", "compare-options"],
    queryFn: ({ signal }) => api<Resource[]>("/runs?limit=500", { signal }),
  });
  const comparison = useWorkspaceQuery({
    queryKey: ["runs", "comparison", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: ({ signal }) =>
      Promise.all(
        ids.map(async (id) => {
          const [run, metrics] = await Promise.all([
            api<Resource>(`/runs/${id}`, { signal }),
            api<Metric[]>(`/runs/${id}/metrics?limit=500`, { signal }),
          ]);
          return { run, metrics };
        }),
      ),
  });
  const entries = comparison.data || [];
  const compatible =
    entries.length > 0 &&
    entries.every((entry) => sameEvaluation(entries[0].run, entry.run));
  const parameterKeys = [
    ...new Set(
      entries.flatMap(({ run }) => Object.keys(run.hyperparameters || {})),
    ),
  ].sort();
  const environmentKeys = [
    ...new Set(
      entries.flatMap(({ run }) => Object.keys(run.environment || {})),
    ),
  ].sort();
  const provenanceKeys = [
    ...new Set(entries.flatMap(({ run }) => Object.keys(run.provenance || {}))),
  ].sort();
  function cell(value: unknown) {
    return value === undefined || value === null
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  }
  function exportReport() {
    downloadCsv(
      "model-lab-run-comparison.csv",
      [
        "run",
        "experiment",
        "status",
        "metric",
        "split",
        "unit",
        "direction",
        "aggregation",
        "score",
        ...parameterKeys.map((key) => `parameter:${key}`),
        ...environmentKeys.map((key) => `environment:${key}`),
        ...provenanceKeys.map((key) => `provenance:${key}`),
      ],
      entries.map(({ run }) => [
        run.name,
        run.experiment_name,
        run.status,
        run.primary_metric,
        run.metric_split,
        run.metric_unit,
        run.metric_direction,
        run.metric_aggregation,
        run.score,
        ...parameterKeys.map((key) => run.hyperparameters?.[key]),
        ...environmentKeys.map((key) => run.environment?.[key]),
        ...provenanceKeys.map((key) => run.provenance?.[key]),
      ]),
    );
  }
  return (
    <AppShell>
      <PageHeading
        eyebrow="Inspect the differences"
        title="Compare runs"
        description="Compare configurations and results side by side. Scores are comparable only within the same experiment and evaluation protocol."
      />
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <select
            aria-label="Choose another run"
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
          >
            <option value="">Choose a run to add</option>
            {options.data
              ?.filter((run) => !ids.includes(run.id))
              .map((run) => (
                <option value={run.id} key={run.id}>
                  {run.experiment_name} / {run.name}
                </option>
              ))}
          </select>
          <button
            className="primary-button"
            disabled={!candidate || ids.length >= 4}
            onClick={() => {
              setIds((current) => [...current, candidate]);
              setCandidate("");
            }}
          >
            Add run
          </button>
        </div>
        <button
          className="secondary-button"
          disabled={!entries.length}
          onClick={exportReport}
        >
          Export comparison CSV
        </button>
      </div>
      <div className={styles.tags}>
        {ids.map((id) => (
          <button
            className="secondary-button"
            key={id}
            onClick={() =>
              setIds((current) => current.filter((value) => value !== id))
            }
          >
            Remove{" "}
            {entries.find((entry) => entry.run.id === id)?.run.name || id} ×
          </button>
        ))}
      </div>
      {comparison.isFetching && <p role="status">Loading comparison…</p>}
      {comparison.isError && (
        <ErrorNotice message={messageOf(comparison.error)} />
      )}
      {!ids.length && (
        <p className={styles.notice}>
          Select up to four runs here, or use the Compare checkboxes on the{" "}
          <Link className={styles.link} href="/runs">
            Runs page
          </Link>
          .
        </p>
      )}
      {entries.length > 0 && (
        <>
          {!compatible && (
            <p className={styles.notice}>
              These runs use different or unconfirmed evaluation protocols.
              Their configurations are shown, but a combined ranking or curve
              would be misleading.
            </p>
          )}
          <section className={`panel ${styles.section} ${styles.scroll}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Configuration / result</th>
                  {entries.map(({ run }) => (
                    <th key={run.id}>
                      <Link className={styles.link} href={`/runs/${run.id}`}>
                        {run.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Experiment</th>
                  {entries.map(({ run }) => (
                    <td key={run.id}>
                      <Link href={`/experiments/${run.experiment_id}`}>
                        {run.experiment_name}
                      </Link>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Status</th>
                  {entries.map(({ run }) => (
                    <td key={run.id}>
                      <StatusBadge value={run.status || "running"} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Primary metric</th>
                  {entries.map(({ run }) => (
                    <td key={run.id}>
                      {run.metric_policy_confirmed === false && (
                        <p className={styles.notice}>
                          Protocol review required
                        </p>
                      )}
                      {run.primary_metric} · {run.metric_split} ·{" "}
                      {run.metric_unit}
                      <br />
                      {run.metric_direction === "min" ? "Lower" : "Higher"} is
                      better · {run.metric_aggregation}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Primary score</th>
                  {entries.map(({ run }) => (
                    <td key={run.id}>
                      <strong>
                        {formatMetric(
                          run.metric_policy_confirmed === false
                            ? null
                            : run.score,
                          run.metric_unit,
                        )}
                      </strong>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Model version</th>
                  {entries.map(({ run }) => (
                    <td key={run.id}>
                      {run.model_name || "Unlinked"} {run.model_version}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Started / ended</th>
                  {entries.map(({ run }) => (
                    <td key={run.id}>
                      {formatDate(run.started_at)}
                      <br />
                      {formatDate(run.ended_at)}
                    </td>
                  ))}
                </tr>
                {parameterKeys.map((key) => (
                  <tr key={`param:${key}`}>
                    <th>Parameter · {key}</th>
                    {entries.map(({ run }) => (
                      <td key={run.id}>{cell(run.hyperparameters?.[key])}</td>
                    ))}
                  </tr>
                ))}
                {environmentKeys.map((key) => (
                  <tr key={`env:${key}`}>
                    <th>Environment · {key}</th>
                    {entries.map(({ run }) => (
                      <td key={run.id}>{cell(run.environment?.[key])}</td>
                    ))}
                  </tr>
                ))}
                {provenanceKeys.map((key) => (
                  <tr key={`provenance:${key}`}>
                    <th>Provenance · {key}</th>
                    {entries.map(({ run }) => (
                      <td key={run.id}>{cell(run.provenance?.[key])}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th>Notes</th>
                  {entries.map(({ run }) => (
                    <td key={run.id}>{run.notes || "—"}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>
          {compatible && (
            <section className={`panel ${styles.section}`}>
              <h2>{entries[0].run.primary_metric} by step</h2>
              <p className={styles.help}>
                {entries[0].run.metric_split} split ·{" "}
                {entries[0].run.metric_unit} · matching readings only
              </p>
              <MetricCurve
                unit={entries[0].run.metric_unit}
                series={entries.map(({ run, metrics }) => ({
                  name: run.name,
                  metrics: metrics.filter((metric) =>
                    metricMatches(metric, run),
                  ),
                }))}
              />
              <p className={styles.help}>
                Up to 500 readings per run. Each run’s detail page provides the
                exact reading table.
              </p>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
