"use client";

import Link from "next/link";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useWorkspaceQuery } from "@/components/providers";
import { ErrorNotice, PageHeading } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { downloadCsv, formatMetric, type Resource } from "@/lib/workspace";
import styles from "@/components/resource-workspace.module.css";

type Entry = Resource & {
  run: string;
  experiment: string;
  model: string | null;
  version: string | null;
  rank: number;
};

export default function LeaderboardPage() {
  const [chosen, setChosen] = useState("");
  const experiments = useWorkspaceQuery({
    queryKey: ["experiments", "leaderboard-options"],
    queryFn: ({ signal }) =>
      api<Resource[]>("/experiments?limit=500", { signal }),
  });
  const experiment =
    experiments.data?.find((item) => item.id === chosen) ||
    experiments.data?.[0];
  const ranking = useWorkspaceQuery({
    queryKey: ["leaderboard", experiment?.id || ""],
    enabled: !!experiment && experiment.metric_policy_confirmed !== false,
    queryFn: ({ signal }) =>
      api<Entry[]>(`/leaderboard?experiment_id=${experiment?.id}&limit=500`, {
        signal,
      }),
  });
  const rows = experiment?.metric_policy_confirmed === false ? [] : ranking.data || [];
  return (
    <AppShell>
      <PageHeading
        eyebrow="Comparable results"
        title="Leaderboard"
        description="Rank completed runs within one experiment, using its chosen metric, split, unit, and optimization direction."
      />
      <div className={styles.toolbar}>
        <label className="field">
          <span>Experiment</span>
          <select
            value={experiment?.id || ""}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="" disabled>
              Choose an experiment
            </option>
            {experiments.data?.map((item) => (
              <option value={item.id} key={item.id}>
                {item.project_name} / {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `${experiment?.name || "experiment"}-leaderboard.csv`,
              [
                "rank",
                "run",
                "model",
                "version",
                "metric",
                "split",
                "unit",
                "score",
              ],
              rows.map((row) => [
                row.rank,
                row.run,
                row.model,
                row.version,
                row.primary_metric,
                row.metric_split,
                row.metric_unit,
                row.score,
              ]),
            )
          }
        >
          Export ranking CSV
        </button>
      </div>
      {experiment && (
        <div className={styles.policy}>
          <span>{experiment.primary_metric}</span>
          <span>{experiment.metric_split} split</span>
          <span>{experiment.metric_unit}</span>
          <span>
            {experiment.metric_direction === "min" ? "Lower" : "Higher"} is
            better
          </span>
          <span>
            {experiment.metric_aggregation === "final" ? "Final" : "Best"}{" "}
            reading
          </span>
          <Link className={styles.link} href={`/experiments/${experiment.id}`}>
            Edit protocol →
          </Link>
        </div>
      )}
      {experiment?.metric_policy_confirmed === false && (
        <p className={styles.notice} role="status">
          Historical results are preserved, but their evaluation protocol needs
          review before scores can be ranked.{" "}
          <Link className={styles.link} href={`/experiments/${experiment.id}`}>
            Review and confirm protocol →
          </Link>
        </p>
      )}
      {(ranking.isFetching || experiments.isPending) && (
        <p role="status">Loading ranking…</p>
      )}
      {ranking.isError && <ErrorNotice message={messageOf(ranking.error)} />}
      <section className={`panel ${styles.section} ${styles.scroll}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Run</th>
              <th>Model version</th>
              <th>Primary score</th>
              <th>Metric</th>
              <th>Split</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.rank}</td>
                <td>
                  <Link className={styles.link} href={`/runs/${row.id}`}>
                    {row.run || row.name}
                  </Link>
                </td>
                <td>
                  {row.model || "Unlinked"} {row.version}
                </td>
                <td>
                  <strong>{formatMetric(row.score, row.metric_unit)}</strong>
                </td>
                <td>{row.primary_metric}</td>
                <td>{row.metric_split}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!ranking.isFetching && !rows.length && experiment?.metric_policy_confirmed !== false && (
          <p className={styles.notice}>
            {experiment
              ? "Complete a run and log a metric that matches this experiment’s evaluation protocol to appear here."
              : "Create an experiment and define its evaluation metric to start comparing runs."}{" "}
            <Link
              className={styles.link}
              href={
                experiment
                  ? `/runs?experiment_id=${experiment.id}`
                  : "/experiments"
              }
            >
              Get started →
            </Link>
          </p>
        )}
      </section>
    </AppShell>
  );
}
