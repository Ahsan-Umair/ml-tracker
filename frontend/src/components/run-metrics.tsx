"use client";

import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceQuery } from "@/components/providers";
import { ErrorNotice, Field, Modal, SubmitButton } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import {
  downloadCsv,
  formatMetric,
  type Metric,
  type Resource,
} from "@/lib/workspace";
import styles from "./resource-workspace.module.css";

const colors = ["#27785f", "#a46a26", "#407eaf", "#9c59a8"];
export type MetricSeries = { name: string; metrics: Metric[] };

export function MetricCurve({
  series,
  unit = "",
}: {
  series: MetricSeries[];
  unit?: string;
}) {
  const labelId = useId();
  const values = series.flatMap((line) =>
    line.metrics.map((metric) => metric.value),
  );
  if (!values.length)
    return <p className={styles.help}>No readings for this metric yet.</p>;
  const steps = series.flatMap((line) =>
    line.metrics.map((metric, index) => metric.step ?? index),
  );
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.max(Math.abs(high) * 0.1, 1);
  const min = low - span * 0.08;
  const max = high + span * 0.08;
  const minX = Math.min(...steps);
  const maxX = Math.max(...steps);
  const x = (step: number) =>
    65 + (maxX === minX ? 0.5 : (step - minX) / (maxX - minX)) * 590;
  const y = (value: number) => 230 - ((value - min) / (max - min)) * 195;
  return (
    <div className={styles.chartGrid}>
      <svg
        className={styles.chart}
        viewBox="0 0 700 285"
        role="img"
        aria-labelledby={labelId}
      >
        <title id={labelId}>
          Metric values by step. Exact readings are available in the table
          below.
        </title>
        {[0, 0.5, 1].map((fraction) => {
          const value = min + fraction * (max - min);
          return (
            <g key={fraction}>
              <line
                x1="65"
                y1={y(value)}
                x2="655"
                y2={y(value)}
                strokeDasharray="4 5"
              />
              <text x="5" y={y(value) + 4}>
                {formatMetric(value, unit)}
              </text>
            </g>
          );
        })}
        <text x="65" y="260">
          {minX}
        </text>
        <text x="655" y="260" textAnchor="end">
          {maxX}
        </text>
        <text x="350" y="280" textAnchor="middle">
          Step / reading index
        </text>
        {series.map((line, lineIndex) => {
          const stride = Math.max(1, Math.ceil(line.metrics.length / 180));
          const points = line.metrics
            .map((metric, index) => ({ metric, index }))
            .filter(
              (_, index, all) =>
                index % stride === 0 || index === all.length - 1,
            );
          return (
            <g key={line.name}>
              <polyline
                points={points
                  .map(
                    ({ metric, index }) =>
                      `${x(metric.step ?? index)},${y(metric.value)}`,
                  )
                  .join(" ")}
                fill="none"
                stroke={colors[lineIndex % colors.length]}
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              {points.map(({ metric, index }) => (
                <circle
                  key={metric.id}
                  cx={x(metric.step ?? index)}
                  cy={y(metric.value)}
                  r={points.length > 80 ? 2 : 3.5}
                  fill={colors[lineIndex % colors.length]}
                >
                  <title>
                    {line.name}, step {metric.step ?? index}:{" "}
                    {formatMetric(metric.value, unit)}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className={styles.legend}>
        {series.map((line, index) => (
          <span key={line.name}>
            <i
              className={styles.dot}
              style={{ background: colors[index % colors.length] }}
            />
            {line.name}
          </span>
        ))}
      </div>
      {series.some((line) => line.metrics.length > 180) && (
        <p className={styles.help}>
          The plot samples long histories for responsiveness; exported readings
          retain full precision.
        </p>
      )}
    </div>
  );
}

function groupKey(metric: Metric, run: Resource) {
  const primary = metric.name === run.primary_metric;
  return JSON.stringify([
    metric.name,
    metric.split ||
      (primary ? run.metric_split || "validation" : "unspecified"),
    metric.unit || (primary ? run.metric_unit || "fraction" : "number"),
  ]);
}

export function RunMetrics({ run }: { run: Resource }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState<Metric[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [tablePage, setTablePage] = useState(0);
  const query = useWorkspaceQuery({
    queryKey: ["metrics", run.id],
    queryFn: ({ signal }) =>
      api<Metric[]>(`/runs/${run.id}/metrics?limit=500`, { signal }),
  });
  const all = [...(query.data || []), ...extra];
  const groups = [...new Set(all.map((metric) => groupKey(metric, run)))];
  const chosen = groups.includes(selected)
    ? selected
    : groups.find((key) => JSON.parse(key)[0] === run.primary_metric) ||
      groups[0] ||
      "";
  const [metricName = "", split = "", unit = ""]: string[] = chosen
    ? JSON.parse(chosen)
    : [];
  const metrics = all.filter((metric) => groupKey(metric, run) === chosen);
  const mutation = useMutation({
    mutationFn: (body: object) =>
      api(`/runs/${run.id}/metrics`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setExtra([]);
      setHasMore(true);
      setTablePage(0);
      void qc.invalidateQueries({ queryKey: ["metrics", run.id] });
      void qc.invalidateQueries({ queryKey: ["runs"] });
      setOpen(false);
    },
    onError: (cause) => setError(messageOf(cause)),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      name: data.get("name"),
      value: Number(data.get("value")),
      step: data.get("step") ? Number(data.get("step")) : null,
      split: data.get("split"),
      unit: data.get("unit"),
    });
  }
  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      const next = await api<Metric[]>(`/runs/${run.id}/metrics?limit=500&offset=${all.length}`);
      const existing = new Set(all.map(metric => metric.id));
      setExtra(current => [...current, ...next.filter(metric => !existing.has(metric.id))]);
      setHasMore(next.length === 500);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <section className={`panel ${styles.section}`}>
      <div className={styles.header}>
        <div>
          <h2>Metric history</h2>
          <p className={styles.help}>
            Inspect learning curves and exact readings for this run.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            className="secondary-button"
            disabled={!all.length}
            onClick={() =>
              downloadCsv(
                `${run.name}-metrics.csv`,
                ["metric", "value", "step", "split", "unit"],
                all.map((metric) => [
                  metric.name,
                  metric.value,
                  metric.step ?? "",
                  metric.split || run.metric_split,
                  metric.unit || run.metric_unit,
                ]),
              )
            }
          >
            Export CSV
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            Log metric
          </button>
        </div>
      </div>
      {query.isPending && <p role="status">Loading readings…</p>}
      {query.isError && <ErrorNotice message={messageOf(query.error)} />}
      {error && !open && <ErrorNotice message={error} />}
      {groups.length ? (
        <>
          <label className="field">
            <span>Metric / split / unit</span>
            <select
              value={chosen}
              onChange={(event) => { setSelected(event.target.value); setTablePage(0); }}
            >
              {groups.map((key) => {
                const parts: string[] = JSON.parse(key);
                return (
                  <option value={key} key={key}>
                    {parts.join(" · ")}
                  </option>
                );
              })}
            </select>
          </label>
          <MetricCurve
            series={[{ name: `${metricName} · ${split}`, metrics }]}
            unit={unit}
          />
          <details open>
            <summary>Exact readings ({metrics.length} loaded)</summary>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Metric</th>
                    <th>Value</th>
                    <th>Split</th>
                    <th>Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.slice(tablePage * 50, (tablePage + 1) * 50).map((metric) => (
                    <tr key={metric.id}>
                      <td>{metric.step ?? "—"}</td>
                      <td>{metric.name}</td>
                      <td>{formatMetric(metric.value, unit)}</td>
                      <td>{split}</td>
                      <td>{unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.pagination}>
              <button className="secondary-button" disabled={tablePage === 0} onClick={() => setTablePage(current => current - 1)}>Previous readings</button>
              <span>Page {tablePage + 1}</span>
              <button className="secondary-button" disabled={(tablePage + 1) * 50 >= metrics.length} onClick={() => setTablePage(current => current + 1)}>Next readings</button>
            </div>
          </details>
          {all.length >= 500 && hasMore && (
            <div className={styles.notice}>
              <p>{all.length} readings loaded. Load more readings to extend the curve and CSV export.</p>
              <button className="secondary-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load 500 more readings"}</button>
            </div>
          )}
        </>
      ) : (
        !query.isPending && (
          <p className={styles.notice}>
            No metrics recorded. Log a reading here or use the Python client
            from your training code.
          </p>
        )
      )}
      <Modal
        title="Log a metric"
        open={open}
        pending={mutation.isPending}
        onClose={() => setOpen(false)}
      >
        <form className="modal-form" onSubmit={submit}>
          {error && <ErrorNotice message={error} />}
          <Field label="Metric name">
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={run.primary_metric || "val_accuracy"}
            />
          </Field>
          <div className="form-grid">
            <Field label="Value">
              <input name="value" type="number" step="any" required />
            </Field>
            <Field label="Step / epoch">
              <input name="step" type="number" min="0" step="1" />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Split">
              <input
                name="split"
                maxLength={40}
                defaultValue={run.metric_split || "validation"}
              />
            </Field>
            <Field label="Unit" hint="Fraction means 0–1; percent means 0–100.">
              <select name="unit" defaultValue={run.metric_unit || "fraction"}>
                {["fraction", "percent", "number", "ms", "s", "bytes"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <SubmitButton pending={mutation.isPending}>Save reading</SubmitButton>
        </form>
      </Modal>
    </section>
  );
}
