"use client";

import AccuracyChart from "@/components/accuracy-chart";
import Link from "next/link";
import {
  Boxes,
  BrainCircuit,
  CircleGauge,
  GitBranch,
  Play,
  Plus,
  Trophy,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth, useWorkspaceQuery } from "@/components/providers";
import {
  CardSkeleton,
  EmptyState,
  PageHeading,
  StatusBadge,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

type Dashboard = {
  stats: {
    projects: number;
    model_versions: number;
    runs: number;
    best_accuracy: number | null;
  };
  recentRuns: Array<{
    id: string;
    name: string;
    status: string;
    experiment: string;
    score: number | null;
    started_at: string;
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
const percent = (value: number | null) =>
  value == null ? "—" : `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { data, isLoading } = useWorkspaceQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/dashboard"),
    enabled: !!user,
  });
  const stats = data?.stats;
  const trend =
    data?.trend.map((item) => ({
      ...item,
      value: item.value <= 1 ? item.value * 100 : item.value,
    })) || [];
  return (
    <AppShell>
      <PageHeading
        eyebrow={`YOUR WORKSPACE${user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}`}
        title="A clearer view of your progress."
        description="Every experiment is a step forward. Here’s where your work stands."
        actionLabel="Log a run"
        action={() => router.push("/runs")}
      />
      {data && data.stats.projects === 0 && (
        <section className="onboarding-panel">
          <div>
            <p className="eyebrow">YOUR FIRST EXPERIMENT STARTS HERE</p>
            <h2>Big ideas. Small first steps.</h2>
            <p>
              Create a project, register a model, then record what you learn.
            </p>
            <Link className="primary-button" href="/projects">
              <Plus size={16} />
              Create your first project
            </Link>
          </div>
          <ol>
            <li>
              <span>01</span>Give your idea a project
            </li>
            <li>
              <span>02</span>Register a model & version
            </li>
            <li>
              <span>03</span>Run an experiment & log results
            </li>
          </ol>
        </section>
      )}
      <section className="metric-grid" aria-label="Workspace summary">
        {[
          {
            label: "Active projects",
            value: stats?.projects ?? 0,
            change: "Organized workspaces",
            icon: Boxes,
            accent: "#27785f",
          },
          {
            label: "Model versions",
            value: stats?.model_versions ?? 0,
            change: "Registered snapshots",
            icon: GitBranch,
            accent: "#b38553",
          },
          {
            label: "Experiment runs",
            value: stats?.runs ?? 0,
            change: "Tracked attempts",
            icon: CircleGauge,
            accent: "#638f9b",
          },
          {
            label: "Best accuracy",
            value: percent(stats?.best_accuracy ?? null),
            change: "Across accuracy metrics",
            icon: Trophy,
            accent: "#74934a",
          },
        ].map(({ label, value, change, icon: Icon, accent }) => (
          <article
            className="metric-card"
            style={{ "--accent": accent } as React.CSSProperties}
            key={label}
          >
            <div className="metric-label">
              <span>{label}</span>
              <Icon size={15} />
            </div>
            <div className="metric-value">{isLoading ? "…" : value}</div>
            <div className="metric-change">{change}</div>
          </article>
        ))}
      </section>
      <section className="content-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Accuracy trend</h2>
              <p className="panel-subtitle">
                Best daily score across your recent runs
              </p>
            </div>
            {trend.length > 0 && <span className="status">Tracking</span>}
          </div>
          <div className="chart-wrap">
            {trend.length ? (
              <AccuracyChart trend={trend} />
            ) : (
              <EmptyState
                title="No metric trend yet"
                description="Log an accuracy metric on a run and your progress curve will appear here."
              />
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Recent runs</h2>
              <p className="panel-subtitle">Latest training activity</p>
            </div>
            <Play size={15} />
          </div>
          <div className="run-list">
            {data?.recentRuns.length ? (
              data.recentRuns.map((run, index) => (
                <div className="run-row" key={run.id}>
                  <div className="run-icon">
                    {index === 0 ? (
                      <BrainCircuit size={15} />
                    ) : (
                      <GitBranch size={15} />
                    )}
                  </div>
                  <div>
                    <Link href="/runs" className="run-name">
                      {run.name}
                    </Link>
                    <div className="run-meta">{run.experiment}</div>
                  </div>
                  <StatusBadge value={run.status} />
                </div>
              ))
            ) : (
              <div className="compact-empty">
                <p>No runs yet.</p>
                <button onClick={() => router.push("/runs")}>
                  <Plus size={13} /> Log one
                </button>
              </div>
            )}
          </div>
        </article>
      </section>
      <section className="panel table-panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Top models</h2>
            <p className="panel-subtitle">
              Ranked by your primary accuracy metric
            </p>
          </div>
          <UserRound size={15} />
        </div>
        {isLoading ? (
          <CardSkeleton />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Project</th>
                  <th>Framework</th>
                  <th>Versions</th>
                  <th>Best score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.topModels.map((model, index) => (
                  <tr key={model.id}>
                    <td>
                      <div className="model-cell">
                        <span
                          className="model-dot"
                          style={
                            {
                              "--dot": ["#27785f", "#b38553", "#638f9b"][
                                index % 3
                              ],
                            } as React.CSSProperties
                          }
                        />
                        <Link href="/models">{model.name}</Link>
                      </div>
                    </td>
                    <td className="muted">{model.project}</td>
                    <td className="muted">{model.framework}</td>
                    <td>{model.versions}</td>
                    <td>
                      <strong>{percent(model.score)}</strong>
                    </td>
                    <td>
                      <StatusBadge value={model.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.topModels.length && (
              <EmptyState
                title="No registered models"
                description="Add your first model and its versions to start building a durable registry."
                action={() => router.push("/models")}
              />
            )}
          </div>
        )}
      </section>
    </AppShell>
  );
}
