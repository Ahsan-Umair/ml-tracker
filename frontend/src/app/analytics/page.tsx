"use client";
import { useWorkspaceQuery } from "@/components/providers";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PageHeading } from "@/components/ui";
import { api } from "@/lib/api";
type Analytics = {
  runStatuses: Array<{ status: string; count: number }>;
  frameworks: Array<{ framework: string; count: number }>;
  storage: Array<{ project: string; datasets: number; bytes: number }>;
  metricNames: Array<{ name: string; readings: number }>;
};
function Bars({
  items,
  unit = "",
}: {
  items: Array<{ label: string; value: number }>;
  unit?: string;
}) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return items.length ? (
    <ul className="bar-chart">
      {items.map((item, i) => (
        <li key={item.label}>
          <div>
            <span>
              <i className="chart-index">{String(i + 1).padStart(2, "0")}</i>
              {item.label}
            </span>
            <strong>
              {item.value.toLocaleString()}
              {unit}
            </strong>
          </div>
          <div className="bar-track" aria-hidden="true">
            <div style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <div className="compact-empty">Nothing recorded yet.</div>
  );
}
export default function AnalyticsPage() {
  const { data } = useWorkspaceQuery({
    queryKey: ["analytics"],
    queryFn: () => api<Analytics>("/analytics"),
  });
  const hasData =
    !!data &&
    data.runStatuses.length + data.frameworks.length + data.storage.length > 0;
  return (
    <AppShell>
      <PageHeading
        eyebrow="THE BIGGER PICTURE"
        title="Patterns in your progress."
        description="Understand your run outcomes, model choices, and the data behind your experiments."
      />
      {hasData ? (
        <div className="analytics-grid">
          {[
            {
              title: "Run outcomes",
              copy: "Every attempt tells you something",
              items: data.runStatuses.map((x) => ({
                label: x.status,
                value: x.count,
              })),
            },
            {
              title: "Framework mix",
              copy: "Registered models by framework",
              items: data.frameworks.map((x) => ({
                label: x.framework,
                value: x.count,
              })),
            },
            {
              title: "Dataset footprint",
              copy: "Referenced storage by project · bytes",
              items: data.storage.map((x) => ({
                label: x.project,
                value: x.bytes,
              })),
            },
            {
              title: "Metrics you track",
              copy: "Number of recorded readings",
              items: data.metricNames.map((x) => ({
                label: x.name,
                value: x.readings,
              })),
            },
          ].map(({ title, copy, items }) => (
            <article className="panel analytics-panel" key={title}>
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">{title}</h2>
                  <p className="panel-subtitle">{copy}</p>
                </div>
                <span className="chart-total">
                  {items.reduce((sum, x) => sum + x.value, 0).toLocaleString()}
                </span>
              </div>
              <Bars items={items} />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Your patterns will take shape here"
          description="Add models, datasets, and runs to see what’s working across your workspace."
        />
      )}
    </AppShell>
  );
}
