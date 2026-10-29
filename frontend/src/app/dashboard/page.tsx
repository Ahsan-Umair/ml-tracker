"use client";
import Link from "next/link";
import { useState } from "react";
import { Boxes, GitBranch, CircleGauge, Trophy } from "lucide-react";
import MetricTrend from "@/components/accuracy-chart";
import { AppShell } from "@/components/app-shell";
import { useAuth, useWorkspaceQuery } from "@/components/providers";
import { EmptyState, PageHeading, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
type Policy = {
  name: string;
  direction: string;
  aggregation: string;
  unit: string;
  split: string;
  experimentId: string;
  experimentName: string;
  confirmed?: boolean;
};
type Dashboard = {
  stats: {
    projects: number;
    model_versions: number;
    runs: number;
    best_score: number | null;
  };
  selectedMetric: Policy | null;
  recentRuns: Array<{
    id: string;
    name: string;
    status: string;
    experiment: string;
    score: number | null;
  }>;
  trend: Array<{ day: string; value: number }>;
  topModels: Array<{
    id: string;
    name: string;
    project: string;
    framework: string;
    status: string;
    score: number | null;
    versions: number;
  }>;
};
function score(v: number | null | undefined, unit = "") {
  if (v == null) return "—";
  return unit === "fraction"
    ? `${(v * 100).toFixed(2)}%`
    : `${Number(v.toPrecision(5))}${unit === "percent" ? "%" : unit && unit !== "number" ? ` ${unit}` : ""}`;
}
export default function DashboardPage() {
  const { user } = useAuth();
  const [experimentId, setExperimentId] = useState("");
  const query = useWorkspaceQuery({
    queryKey: ["dashboard", experimentId],
    queryFn: ({ signal }) =>
      api<Dashboard>(
        `/dashboard${experimentId ? `?experiment_id=${encodeURIComponent(experimentId)}` : ""}`,
        { signal },
      ),
  });
  const experiments = useWorkspaceQuery({
    queryKey: ["dashboard-experiments"],
    queryFn: ({ signal }) =>
      api<Array<{ id: string; name: string }>>("/experiments?limit=500", {
        signal,
      }),
  });
  const data = query.data,
    metric = data?.selectedMetric;
  return (
    <AppShell>
      <PageHeading
        eyebrow={`YOUR WORKSPACE${user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}`}
        title="A clearer view of your progress."
        description="Track comparable results and follow every experiment through to its outcome."
      />
      <div className="panel" style={{ padding: 20, marginBottom: 24 }}>
        <label className="field">
          <span>Experiment for scores and trends</span>
          <select
            aria-label="Experiment for scores and trends"
            value={experimentId}
            onChange={(e) => setExperimentId(e.target.value)}
          >
            <option value="">Most recently updated experiment</option>
            {experiments.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <p className="panel-subtitle">
          {metric
            ? `${metric.experimentName} · ${metric.name} · ${metric.split || "unspecified split"} · ${metric.aggregation} reading · ${metric.direction === "min" ? "lower" : "higher"} is better`
            : "Choose or create an experiment to see comparable results."}
        </p>
      </div>
      {metric?.confirmed === false && (
        <p className="error-notice" role="status">
          Legacy results use mixed or uncertain units.{" "}
          <Link href={`/experiments/${metric.experimentId}`}>
            Review and confirm the experiment’s metric policy
          </Link>{" "}
          before ranking results.
        </p>
      )}
      {query.isPending && <p role="status">Loading your dashboard…</p>}
      {data && (data.stats.projects === 0 || data.stats.runs === 0) && (
        <section className="onboarding-panel">
          <div>
            <p className="eyebrow">BUILD YOUR FIRST EXPERIMENT</p>
            <h2>Keep the whole story together.</h2>
            <p>
              Set up your project, define the metric that matters, then record
              an attempt.
            </p>
          </div>
          <ol>
            <li>
              <Link href="/projects">01 · Create a project</Link>
            </li>
            <li>
              <Link href="/models">02 · Register a model and version</Link>
            </li>
            <li>
              <Link href="/experiments">
                03 · Define an experiment and scoring policy
              </Link>
            </li>
            <li>
              <Link href="/runs">04 · Log a run and its metrics</Link>
            </li>
          </ol>
        </section>
      )}
      <section className="metric-grid" aria-label="Workspace summary">
        {[
          {
            label: "Projects",
            value: data?.stats.projects,
            copy: "Organized workspaces",
            Icon: Boxes,
          },
          {
            label: "Model versions",
            value: data?.stats.model_versions,
            copy: "Registered snapshots",
            Icon: GitBranch,
          },
          {
            label: "Experiment runs",
            value: data?.stats.runs,
            copy: "Tracked attempts",
            Icon: CircleGauge,
          },
          {
            label: metric ? `Best ${metric.name}` : "Best experiment score",
            value: score(data?.stats.best_score, metric?.unit),
            copy: metric
              ? "Within the selected experiment"
              : "Select an experiment",
            Icon: Trophy,
          },
        ].map(({ label, value, copy, Icon }) => (
          <article className="metric-card" key={label}>
            <div className="metric-label">
              <span>{label}</span>
              <Icon size={16} />
            </div>
            <div className="metric-value">
              {query.isPending ? "…" : (value ?? "—")}
            </div>
            <div className="metric-change">{copy}</div>
          </article>
        ))}
      </section>
      <section className="content-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">{metric?.name || "Metric"} trend</h2>
              <p className="panel-subtitle">
                Daily {metric?.aggregation || "best"} readings for one
                experiment and evaluation split
              </p>
            </div>
          </div>
          <div className="chart-wrap">
            {data?.trend.length ? (
              <MetricTrend
                trend={data.trend}
                name={metric?.name}
                unit={metric?.unit}
              />
            ) : (
              <EmptyState
                title="No metric trend yet"
                description="Log the experiment’s primary metric on a run to start its curve."
              />
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Recent runs</h2>
            <Link href="/runs">View all</Link>
          </div>
          <div className="run-list">
            {data?.recentRuns.map((run) => (
              <div className="run-row" key={run.id}>
                <div>
                  <Link className="run-name" href={`/runs/${run.id}`}>
                    {run.name}
                  </Link>
                  <p className="run-meta">{run.experiment}</p>
                </div>
                <StatusBadge value={run.status} />
              </div>
            ))}
            {!query.isPending && !data?.recentRuns.length && (
              <EmptyState
                title="No runs yet"
                description="Log a run manually or connect a notebook from Settings."
              />
            )}
          </div>
        </article>
      </section>
      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Models in focus</h2>
            <p className="panel-subtitle">
              Scores use the selected experiment’s policy.
            </p>
          </div>
          <Link href="/leaderboard">Compare results</Link>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Project</th>
                <th>Framework</th>
                <th>Versions</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.topModels.map((model) => (
                <tr key={model.id}>
                  <td>
                    <Link href={`/models/${model.id}`}>{model.name}</Link>
                  </td>
                  <td>{model.project}</td>
                  <td>{model.framework}</td>
                  <td>{model.versions}</td>
                  <td>{score(model.score, metric?.unit)}</td>
                  <td>
                    <StatusBadge value={model.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!query.isPending && !data?.topModels.length && (
            <EmptyState
              title="No model results yet"
              description="Link a model version to a run to connect its results."
            />
          )}
        </div>
      </section>
    </AppShell>
  );
}
