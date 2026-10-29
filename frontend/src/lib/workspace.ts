export type ResourceKind =
  | "projects"
  | "datasets"
  | "models"
  | "experiments"
  | "runs";

export type MetricPolicy = {
  metric_policy_confirmed?: boolean;
  primary_metric?: string;
  metric_direction?: "max" | "min";
  metric_aggregation?: "best" | "final";
  metric_unit?: string;
  metric_split?: string;
};

export type Resource = MetricPolicy & {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  status?: string;
  archived?: boolean;
  project_id?: string;
  project_name?: string;
  experiment_id?: string;
  experiment_name?: string;
  model_id?: string | null;
  model_name?: string | null;
  model_version_id?: string | null;
  model_version?: string | null;
  dataset_id?: string | null;
  dataset_name?: string | null;
  score?: number | null;
  best_accuracy?: number | null;
  metric_count?: number;
  color?: string;
  objective?: string;
  framework?: string;
  task_type?: string;
  repository_url?: string;
  version?: string;
  format?: string;
  uri?: string;
  checksum?: string;
  size_bytes?: number;
  row_count?: number | null;
  versions?: number;
  experiments?: number;
  datasets?: number;
  models?: number;
  runs?: number;
  run_type?: string;
  notes?: string;
  hyperparameters?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  parent_run_id?: string | null;
  started_at?: string;
  ended_at?: string | null;
};

export type Version = {
  id: string;
  model_id: string;
  version: string;
  stage: string;
  model_name?: string;
  project_id?: string;
  artifact_uri?: string;
  checksum?: string;
  parameters_count?: number | null;
  notes?: string;
  created_at?: string;
};

export type Metric = {
  id: string;
  name: string;
  value: number;
  step: number | null;
  unit?: string;
  split?: string;
  created_at?: string;
};

export const resourceLabels: Record<
  ResourceKind,
  { title: string; singular: string; action: string; description: string }
> = {
  projects: {
    title: "Projects",
    singular: "project",
    action: "New project",
    description: "Keep a goal, its data, models, and experiments together.",
  },
  datasets: {
    title: "Datasets",
    singular: "dataset",
    action: "Register dataset",
    description:
      "Version your data references and record where each result came from.",
  },
  models: {
    title: "Models",
    singular: "model",
    action: "Register model",
    description:
      "Follow each model from the first candidate to a production version.",
  },
  experiments: {
    title: "Experiments",
    singular: "experiment",
    action: "New experiment",
    description:
      "Define the question, evaluation protocol, and metric before comparing results.",
  },
  runs: {
    title: "Runs",
    singular: "run",
    action: "Log a run",
    description:
      "Inspect the configuration, provenance, and measurements behind every attempt.",
  },
};

export const statusOptions: Record<ResourceKind, string[]> = {
  projects: [],
  datasets: [],
  models: ["development", "staging", "production", "archived"],
  experiments: ["draft", "running", "completed", "failed", "archived"],
  runs: ["queued", "running", "completed", "failed", "cancelled"],
};

export function formatMetric(value: number | null | undefined, unit = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "fraction")
    return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
  if (unit === "percent" || unit === "%")
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
  return `${value.toLocaleString(undefined, { maximumSignificantDigits: 6 })}${unit && unit !== "number" ? ` ${unit}` : ""}`;
}

export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null || bytes === 0) return "Size unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`;
}

export function formatDate(date?: string | null) {
  if (!date) return "—";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString();
}

export function tagsFrom(value: FormDataEntryValue | null) {
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

export function jsonObject(
  value: FormDataEntryValue | null,
  label: string,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(String(value || "{}"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object, such as {"seed": 42}.`);
  return parsed as Record<string, unknown>;
}

export function metricMatches(metric: Metric, policy: MetricPolicy) {
  return (
    metric.name === (policy.primary_metric || "val_accuracy") &&
    (metric.split || policy.metric_split || "validation") ===
      (policy.metric_split || "validation") &&
    (metric.unit || policy.metric_unit || "fraction") ===
      (policy.metric_unit || "fraction")
  );
}

export function sameEvaluation(
  left: MetricPolicy & { experiment_id?: string },
  right: MetricPolicy & { experiment_id?: string },
) {
  return (
    left.metric_policy_confirmed !== false &&
    right.metric_policy_confirmed !== false &&
    !!left.experiment_id &&
    left.experiment_id === right.experiment_id &&
    (left.primary_metric || "val_accuracy") ===
      (right.primary_metric || "val_accuracy") &&
    (left.metric_split || "validation") ===
      (right.metric_split || "validation") &&
    (left.metric_unit || "fraction") === (right.metric_unit || "fraction") &&
    (left.metric_direction || "max") === (right.metric_direction || "max") &&
    (left.metric_aggregation || "best") === (right.metric_aggregation || "best")
  );
}

export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function csvCell(value: unknown) {
  const text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe =
    typeof value === "string" && /^(?:\s*[=+\-@]|[\t\r])/.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function downloadCsv(
  name: string,
  headers: string[],
  rows: unknown[][],
) {
  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
