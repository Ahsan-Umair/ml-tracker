"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, messageOf } from "@/lib/api";
import { useWorkspaceQuery } from "@/components/providers";
import { ErrorNotice, Field, SubmitButton } from "@/components/ui";
import {
  jsonObject,
  tagsFrom,
  type Resource,
  type ResourceKind,
  type Version,
} from "@/lib/workspace";
import styles from "./resource-workspace.module.css";

function ObjectEditor({
  name,
  title,
  initial = {},
}: {
  name: string;
  title: string;
  initial?: Record<string, unknown>;
}) {
  const [mode, setMode] = useState<"guided" | "json">("guided");
  const [rows, setRows] = useState(() =>
    Object.entries(initial).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
  );
  const [raw, setRaw] = useState(JSON.stringify(initial, null, 2));
  const [error, setError] = useState("");
  const object = Object.fromEntries(
    rows
      .filter((row) => row.key.trim())
      .map((row) => {
        let value: unknown = row.value;
        try {
          value = JSON.parse(row.value);
        } catch {
          /* Text values remain strings. */
        }
        return [row.key.trim(), value];
      }),
  );
  function toggle() {
    setError("");
    if (mode === "guided") {
      setRaw(JSON.stringify(object, null, 2));
      setMode("json");
    } else {
      try {
        const parsed = jsonObject(raw, title);
        setRows(
          Object.entries(parsed).map(([key, value]) => ({
            key,
            value: typeof value === "string" ? value : JSON.stringify(value),
          })),
        );
        setMode("guided");
      } catch (cause) {
        setError(messageOf(cause));
      }
    }
  }
  return (
    <fieldset className={styles.editor}>
      <legend>{title}</legend>
      <button className="secondary-button" type="button" onClick={toggle}>
        Use {mode === "guided" ? "JSON" : "guided fields"}
      </button>
      {error && <ErrorNotice message={error} />}
      {mode === "json" ? (
        <textarea
          name={name}
          aria-label={`${title} as JSON`}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          rows={6}
          spellCheck={false}
        />
      ) : (
        <>
          <p className={styles.help}>
            Add named values. Numbers, true/false, lists, and objects are
            accepted; ordinary text stays text.
          </p>
          {rows.map((row, index) => (
            <div className={styles.keyValue} key={index}>
              <input
                aria-label={`${title} field ${index + 1}`}
                placeholder="Name"
                value={row.key}
                onChange={(event) =>
                  setRows(
                    rows.map((item, position) =>
                      position === index
                        ? { ...item, key: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <input
                aria-label={`${title} value ${index + 1}`}
                placeholder="Value"
                value={row.value}
                onChange={(event) =>
                  setRows(
                    rows.map((item, position) =>
                      position === index
                        ? { ...item, value: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="secondary-button"
                aria-label={`Remove ${row.key || `field ${index + 1}`}`}
                onClick={() =>
                  setRows(rows.filter((_, position) => position !== index))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <input type="hidden" name={name} value={JSON.stringify(object)} />
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRows([...rows, { key: "", value: "" }])}
          >
            Add field
          </button>
        </>
      )}
    </fieldset>
  );
}

export function MetricPolicyFields({ item }: { item?: Resource }) {
  return (
    <fieldset className={styles.editor}>
      <legend>Evaluation protocol</legend>
      <p className={styles.help}>
        Only results with this metric, split, and unit are ranked together.
      </p>
      {item?.metric_policy_confirmed === false && (
        <p className={styles.notice} role="status">
          This experiment contains historical readings whose evaluation protocol
          needs review. Scores and rankings stay hidden until you confirm the
          metric, split, unit, direction, and aggregation below. The original
          readings are preserved.
        </p>
      )}
      <div className="form-grid">
        <Field label="Primary metric">
          <input
            name="primary_metric"
            required
            maxLength={80}
            defaultValue={item?.primary_metric || "val_accuracy"}
          />
        </Field>
        <Field label="Dataset split">
          <input
            name="metric_split"
            maxLength={40}
            defaultValue={item?.metric_split || "validation"}
            list="split-options"
          />
          <datalist id="split-options">
            <option value="validation" />
            <option value="test" />
            <option value="training" />
          </datalist>
        </Field>
        <Field label="Unit">
          <select
            name="metric_unit"
            defaultValue={item?.metric_unit || "fraction"}
          >
            <option value="fraction">Fraction (0–1 → %)</option>
            <option value="percent">Percent (0–100)</option>
            <option value="number">Number</option>
            <option value="ms">Milliseconds</option>
            <option value="s">Seconds</option>
            <option value="bytes">Bytes</option>
          </select>
        </Field>
        <Field label="Better direction">
          <select
            name="metric_direction"
            defaultValue={item?.metric_direction || "max"}
          >
            <option value="max">Higher is better</option>
            <option value="min">Lower is better</option>
          </select>
        </Field>
        <Field label="Readings to rank">
          <select
            name="metric_aggregation"
            defaultValue={item?.metric_aggregation || "best"}
          >
            <option value="best">Best recorded reading</option>
            <option value="final">Final recorded reading</option>
          </select>
        </Field>
      </div>
      {item?.metric_policy_confirmed === false && (
        <label className={styles.check}>
          <input type="checkbox" name="metric_policy_confirmed" />I reviewed
          this protocol for the historical readings and confirm it should be
          used for scoring.
        </label>
      )}
    </fieldset>
  );
}

export function ResourceForm({
  kind,
  item,
  initialProject = "",
  initialExperiment = "",
  onSaved,
  onPendingChange,
}: {
  kind: ResourceKind;
  item?: Resource;
  initialProject?: string;
  initialExperiment?: string;
  onSaved: (item: Resource) => void;
  onPendingChange?: (value: boolean) => void;
}) {
  const qc = useQueryClient();
  const [project, setProject] = useState(item?.project_id || initialProject);
  const [experimentId, setExperimentId] = useState(
    item?.experiment_id || initialExperiment,
  );
  const [datasetId, setDatasetId] = useState(item?.dataset_id || "");
  const [modelId, setModelId] = useState(item?.model_id || "");
  const [modelVersionId, setModelVersionId] = useState(
    item?.model_version_id || "",
  );
  const [parentRunId, setParentRunId] = useState(item?.parent_run_id || "");
  const [error, setError] = useState("");
  const needsProjects = kind !== "projects" && kind !== "runs";
  const { data: projects = [], isLoading: projectsLoading } = useWorkspaceQuery(
    {
      queryKey: ["projects", "lookups"],
      enabled: needsProjects,
      queryFn: ({ signal }) =>
        api<Resource[]>("/projects?limit=500", { signal }),
    },
  );
  const { data: datasets = [] } = useWorkspaceQuery({
    queryKey: ["datasets", "lookups"],
    enabled: kind === "experiments",
    queryFn: ({ signal }) => api<Resource[]>("/datasets?limit=500", { signal }),
  });
  const { data: models = [] } = useWorkspaceQuery({
    queryKey: ["models", "lookups"],
    enabled: kind === "experiments",
    queryFn: ({ signal }) => api<Resource[]>("/models?limit=500", { signal }),
  });
  const { data: experiments = [], isLoading: experimentsLoading } =
    useWorkspaceQuery({
      queryKey: ["experiments", "lookups"],
      enabled: kind === "runs",
      queryFn: ({ signal }) =>
        api<Resource[]>("/experiments?limit=500", { signal }),
    });
  const { data: versions = [] } = useWorkspaceQuery({
    queryKey: ["model-versions", "lookups"],
    enabled: kind === "runs",
    queryFn: ({ signal }) =>
      api<Version[]>("/model-versions?limit=500", { signal }),
  });
  const { data: runs = [] } = useWorkspaceQuery({
    queryKey: ["runs", "lookups"],
    enabled: kind === "runs",
    queryFn: ({ signal }) => api<Resource[]>("/runs?limit=500", { signal }),
  });
  const experiment = experiments.find((row) => row.id === experimentId);
  const mutation = useMutation({
    mutationFn: (body: object) =>
      api<Resource>(`/${kind}${item ? `/${item.id}` : ""}`, {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (value) => {
      void qc.invalidateQueries({ queryKey: [kind] });
      onSaved(value);
    },
    onError: (cause) => setError(messageOf(cause)),
    onSettled: () => onPendingChange?.(false),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) || "");
    const body: Record<string, unknown> = {
      name: text("name"),
      tags: tagsFrom(data.get("tags")),
    };
    if (kind !== "runs") body.description = text("description");
    if (needsProjects && !item) body.project_id = project;
    if (kind === "projects") body.color = text("color");
    if (kind === "datasets")
      Object.assign(body, {
        version: text("version"),
        format: text("format"),
        uri: text("uri"),
        checksum: text("checksum"),
        size_bytes: Number(text("size_bytes") || 0),
        row_count: text("row_count") ? Number(text("row_count")) : null,
      });
    if (kind === "models")
      Object.assign(body, {
        framework: text("framework"),
        task_type: text("task_type"),
        status: text("status"),
        repository_url: text("repository_url"),
      });
    if (kind === "experiments")
      Object.assign(body, {
        dataset_id: datasetId || null,
        model_id: modelId || null,
        objective: text("objective"),
        primary_metric: text("primary_metric"),
        metric_direction: text("metric_direction"),
        metric_aggregation: text("metric_aggregation"),
        metric_unit: text("metric_unit"),
        metric_split: text("metric_split"),
        metric_policy_confirmed:
          item?.metric_policy_confirmed === false
            ? data.get("metric_policy_confirmed") === "on"
            : true,
      });
    if (kind === "runs") {
      try {
        Object.assign(body, {
          model_version_id: modelVersionId || null,
          parent_run_id: parentRunId || null,
          run_type: text("run_type"),
          hyperparameters: jsonObject(
            data.get("hyperparameters"),
            "Hyperparameters",
          ),
          environment: jsonObject(data.get("environment"), "Environment"),
          provenance: jsonObject(data.get("provenance"), "Provenance"),
          notes: text("notes"),
        });
        if (!item) body.experiment_id = experimentId;
      } catch (cause) {
        setError(messageOf(cause));
        return;
      }
    }
    onPendingChange?.(true);
    mutation.mutate(body);
  }
  const missingParent =
    !item &&
    (needsProjects
      ? !projectsLoading && !projects.length
      : kind === "runs" && !experimentsLoading && !experiments.length);
  return (
    <form className="modal-form" onSubmit={submit}>
      {error && <ErrorNotice message={error} />}
      {missingParent && (
        <p className={styles.notice}>
          Create {kind === "runs" ? "an experiment" : "a project"} first.{" "}
          <Link href={kind === "runs" ? "/experiments" : "/projects"}>
            Go to {kind === "runs" ? "experiments" : "projects"} →
          </Link>
        </p>
      )}
      {needsProjects && (
        <Field label="Project">
          <select
            required
            disabled={!!item || projectsLoading}
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setDatasetId("");
              setModelId("");
            }}
          >
            <option value="">Choose a project</option>
            {projects.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {kind === "runs" && (
        <Field label="Experiment">
          <select
            required
            disabled={!!item || experimentsLoading}
            value={experimentId}
            onChange={(event) => {
              setExperimentId(event.target.value);
              setModelVersionId("");
              setParentRunId("");
            }}
          >
            <option value="">Choose an experiment</option>
            {experiments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.project_name} / {row.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Name">
        <input
          name="name"
          required
          maxLength={kind === "projects" ? 100 : 120}
          defaultValue={item?.name}
          autoFocus
        />
      </Field>
      {kind === "projects" && (
        <Field label="Project color">
          <input
            name="color"
            type="color"
            defaultValue={item?.color || "#27785f"}
          />
        </Field>
      )}
      {kind === "datasets" && (
        <>
          <div className="form-grid">
            <Field label="Version">
              <input
                name="version"
                required
                maxLength={40}
                defaultValue={item?.version || "v1"}
              />
            </Field>
            <Field label="Format">
              <input
                name="format"
                maxLength={40}
                defaultValue={item?.format || "parquet"}
                list="dataset-formats"
              />
              <datalist id="dataset-formats">
                {[
                  "csv",
                  "parquet",
                  "json",
                  "image",
                  "audio",
                  "text",
                  "npz",
                  "other",
                ].map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field
            label="URI or path"
            hint="A reference only; the dataset stays where you host it."
          >
            <input
              name="uri"
              maxLength={2000}
              defaultValue={item?.uri}
              placeholder="hf://org/dataset or s3://bucket/key"
            />
          </Field>
          <Field
            label="Checksum"
            hint="Optional content hash for reproducibility."
          >
            <input
              name="checksum"
              maxLength={256}
              defaultValue={item?.checksum}
            />
          </Field>
          <div className="form-grid">
            <Field label="Size in bytes">
              <input
                type="number"
                min="0"
                step="1"
                name="size_bytes"
                defaultValue={item?.size_bytes || 0}
              />
            </Field>
            <Field label="Rows / samples">
              <input
                type="number"
                min="0"
                step="1"
                name="row_count"
                defaultValue={item?.row_count ?? ""}
              />
            </Field>
          </div>
        </>
      )}
      {kind === "models" && (
        <>
          <div className="form-grid">
            <Field label="Framework">
              <input
                name="framework"
                defaultValue={item?.framework || "PyTorch"}
                maxLength={60}
                list="framework-options"
              />
              <datalist id="framework-options">
                {[
                  "PyTorch",
                  "TensorFlow",
                  "scikit-learn",
                  "XGBoost",
                  "JAX",
                  "Other",
                ].map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>
            <Field label="Task">
              <input
                name="task_type"
                maxLength={80}
                defaultValue={item?.task_type || "Classification"}
              />
            </Field>
          </div>
          <Field label="Lifecycle">
            <select name="status" defaultValue={item?.status || "development"}>
              {["development", "staging", "production", "archived"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </Field>
          <Field label="Repository URL">
            <input
              type="url"
              name="repository_url"
              maxLength={2000}
              defaultValue={item?.repository_url}
              placeholder="https://github.com/…"
            />
          </Field>
        </>
      )}
      {kind === "experiments" && (
        <>
          <Field label="Objective">
            <input
              name="objective"
              maxLength={500}
              defaultValue={item?.objective}
              placeholder="What question does this experiment answer?"
            />
          </Field>
          <div className="form-grid">
            <Field label="Dataset">
              <select
                key={`dataset-${project}`}
                name="dataset_id"
                value={datasetId}
                onChange={(event) => setDatasetId(event.target.value)}
              >
                <option value="">No dataset linked</option>
                {datasets
                  .filter((row) => row.project_id === project)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {row.version}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Model">
              <select
                key={`model-${project}`}
                name="model_id"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="">No model linked</option>
                {models
                  .filter((row) => row.project_id === project)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <MetricPolicyFields item={item} />
        </>
      )}
      {kind === "runs" && (
        <>
          <div className="form-grid">
            <Field label="Run type">
              <select
                name="run_type"
                defaultValue={item?.run_type || "training"}
              >
                {["training", "evaluation", "inference"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="Model version">
              <select
                key={experimentId}
                name="model_version_id"
                value={modelVersionId}
                onChange={(event) => setModelVersionId(event.target.value)}
              >
                <option value="">No version linked</option>
                {versions
                  .filter(
                    (version) =>
                      experiment &&
                      version.project_id === experiment.project_id &&
                      (!experiment.model_id ||
                        version.model_id === experiment.model_id),
                  )
                  .map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.model_name} · {version.version}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field
            label="Parent run"
            hint="Optional earlier run from the same experiment."
          >
            <select
              name="parent_run_id"
              key={`parent-${experimentId}`}
              value={parentRunId}
              onChange={(event) => setParentRunId(event.target.value)}
            >
              <option value="">No parent run</option>
              {runs
                .filter(
                  (run) =>
                    run.experiment_id === experimentId && run.id !== item?.id,
                )
                .map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name}
                  </option>
                ))}
            </select>
          </Field>
          <ObjectEditor
            name="hyperparameters"
            title="Hyperparameters"
            initial={item?.hyperparameters}
          />
          <ObjectEditor
            name="environment"
            title="Environment"
            initial={item?.environment}
          />
          <ObjectEditor
            name="provenance"
            title="Provenance"
            initial={item?.provenance}
          />
          <Field label="Notes">
            <textarea
              name="notes"
              maxLength={4000}
              rows={4}
              defaultValue={item?.notes}
            />
          </Field>
        </>
      )}
      {kind !== "runs" && (
        <Field label="Description">
          <textarea
            name="description"
            maxLength={kind === "experiments" ? 3000 : 2000}
            rows={3}
            defaultValue={item?.description}
          />
        </Field>
      )}
      <Field label="Tags" hint="Comma-separated labels, up to 20.">
        <input
          name="tags"
          defaultValue={item?.tags?.join(", ")}
          placeholder="baseline, vision, seed-42"
        />
      </Field>
      <SubmitButton pending={mutation.isPending || !!missingParent}>
        {item
          ? "Save changes"
          : `Create ${kind === "datasets" ? "dataset reference" : kind.slice(0, -1)}`}
      </SubmitButton>
    </form>
  );
}
