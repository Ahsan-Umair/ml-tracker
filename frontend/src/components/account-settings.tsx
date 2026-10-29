"use client";

import { FormEvent, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, messageOf } from "@/lib/api";
import { useAuth, useWorkspaceQuery, type User } from "@/components/providers";
import { ErrorNotice, Field, Modal, SubmitButton } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

type Session = {
  id: string;
  created_at: string;
  expires_at: string;
  current: boolean;
};
type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  project_id: string | null;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};
type ImportPreview = {
  dryRun: boolean;
  counts: Record<string, number>;
  projectIds?: string[];
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Never";

function LoadState({ pending, error }: { pending: boolean; error: unknown }) {
  return pending ? (
    <p role="status">Loading…</p>
  ) : error ? (
    <ErrorNotice message={messageOf(error)} />
  ) : null;
}

export function ProfileSettings() {
  const { user, refresh } = useAuth();
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    mutationFn: (display_name: string) =>
      api("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ display_name }),
      }),
    onSuccess: async () => {
      await refresh();
      setSaved(true);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    update.mutate(
      String(new FormData(event.currentTarget).get("display_name") || ""),
    );
  }
  return (
    <section className="panel settings-panel">
      <h2>Profile</h2>
      <p>{user?.email}</p>
      <form className="auth-form" key={user?.displayName} onSubmit={submit}>
        <Field label="Display name">
          <input
            name="display_name"
            autoComplete="name"
            minLength={2}
            maxLength={80}
            defaultValue={user?.displayName}
            required
          />
        </Field>
        {update.error && <ErrorNotice message={messageOf(update.error)} />}
        {saved && (
          <p className="success-notice" role="status">
            Profile saved.
          </p>
        )}
        <SubmitButton pending={update.isPending}>Save profile</SubmitButton>
      </form>
    </section>
  );
}

export function PasswordSettings({ onChanged }: { onChanged: () => void }) {
  const { setSession } = useAuth();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const update = useMutation({
    mutationFn: (body: object) =>
      api<{ user: User; csrfToken: string }>("/auth/password", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (body) => {
      setSession(body.user, body.csrfToken);
      setSaved(true);
      onChanged();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("password") !== data.get("confirm_password")) {
      setError("The new passwords don’t match.");
      return;
    }
    update.mutate(
      {
        current_password: data.get("current_password"),
        password: data.get("password"),
      },
      { onSuccess: () => form.reset() },
    );
  }
  return (
    <section className="panel settings-panel">
      <h2>Change password</h2>
      <p>
        Use at least 12 characters. Changing your password signs out other
        sessions and revokes API tokens.
      </p>
      <form className="auth-form" onSubmit={submit}>
        <PasswordInput
          name="current_password"
          label="Current password"
          autoComplete="current-password"
        />
        <PasswordInput
          name="password"
          label="New password"
          autoComplete="new-password"
          minLength={12}
        />
        <PasswordInput
          name="confirm_password"
          label="Confirm new password"
          autoComplete="new-password"
          minLength={12}
        />
        {(error || update.error) && (
          <ErrorNotice message={error || messageOf(update.error)} />
        )}
        {saved && (
          <p className="success-notice" role="status">
            Password updated. This session remains signed in.
          </p>
        )}
        <SubmitButton pending={update.isPending}>Update password</SubmitButton>
      </form>
    </section>
  );
}

export function SessionSettings() {
  const qc = useQueryClient();
  const sessions = useWorkspaceQuery<Session[]>({
    queryKey: ["account-sessions"],
    queryFn: ({ signal }) => api("/auth/sessions", { signal }),
  });
  const revoke = useMutation({
    mutationFn: (id: string | null) =>
      api<void>(
        id ? `/auth/sessions/${encodeURIComponent(id)}` : "/auth/sessions",
        { method: "DELETE" },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["account-sessions"] }),
  });
  return (
    <section className="panel settings-panel settings-wide">
      <h2>Signed-in sessions</h2>
      <p>
        Review session creation and expiry times. You can revoke other sessions
        without changing your password.
      </p>
      <LoadState pending={sessions.isPending} error={sessions.error} />
      {revoke.error && <ErrorNotice message={messageOf(revoke.error)} />}
      <ul className="account-list">
        {sessions.data?.map((session) => (
          <li key={session.id}>
            <div>
              <strong>
                {session.current ? "This session" : "Other session"}
              </strong>
              <small>
                Created {date(session.created_at)} · Expires{" "}
                {date(session.expires_at)}
              </small>
            </div>
            {!session.current && (
              <button
                className="secondary-button danger-text"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(session.id)}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      {(sessions.data?.filter((session) => !session.current).length || 0) >
        0 && (
        <button
          className="secondary-button danger-text"
          disabled={revoke.isPending}
          onClick={() => {
            if (window.confirm("Sign out all other sessions?"))
              revoke.mutate(null);
          }}
        >
          Sign out other sessions
        </button>
      )}
    </section>
  );
}

export function TokenSettings() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const tokens = useWorkspaceQuery<ApiToken[]>({
    queryKey: ["account-tokens"],
    queryFn: ({ signal }) => api("/auth/tokens", { signal }),
  });
  const projects = useWorkspaceQuery<{ id: string; name: string }[]>({
    queryKey: ["projects"],
    enabled: open,
    queryFn: ({ signal }) => api("/projects", { signal }),
  });
  const create = useMutation({
    mutationFn: (body: object) =>
      api<ApiToken & { token: string }>("/auth/tokens", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (body) => {
      setCreated(body.token);
      setCopyMessage("");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["account-tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api<void>(`/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      setCreated("");
      void qc.invalidateQueries({ queryKey: ["account-tokens"] });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    create.mutate({
      name: data.get("name"),
      scopes: data.getAll("scopes"),
      expires_days: Number(data.get("expires_days")),
      project_id: data.get("project_id") || null,
      password: data.get("password"),
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(created);
      setCopyMessage("Copied. Save it privately; it won’t be shown again.");
    } catch {
      setCopyMessage(
        "Copy isn’t available here. Select and copy the token below.",
      );
    }
  }
  return (
    <section className="panel settings-panel settings-wide">
      <h2>API tokens</h2>
      <p>
        Use a scoped token from notebooks or training scripts. Tokens are shown
        once; keep them out of source control and browser storage.
      </p>
      {created && (
        <div className="token-result" role="status">
          <strong>Save this token now</strong>
          <label className="field">
            <span>New API token</span>
            <textarea
              readOnly
              value={created}
              aria-label="New API token"
              spellCheck={false}
              autoComplete="off"
              onFocus={(event) => event.target.select()}
            />
          </label>
          <div className="button-row">
            <button className="secondary-button" onClick={() => void copy()}>
              Copy token
            </button>
            <button className="secondary-button" onClick={() => setCreated("")}>
              I saved it — hide
            </button>
          </div>
          {copyMessage && <p>{copyMessage}</p>}
        </div>
      )}
      <LoadState pending={tokens.isPending} error={tokens.error} />
      {revoke.error && <ErrorNotice message={messageOf(revoke.error)} />}
      <ul className="account-list">
        {tokens.data?.map((token) => (
          <li key={token.id}>
            <div>
              <strong>
                {token.name} <code>{token.prefix}…</code>
              </strong>
              <small>
                {token.scopes.join(", ")} ·{" "}
                {token.project_id ? "Project scoped" : "Workspace scoped"}
              </small>
              <small>
                Expires {date(token.expires_at)} · Last used{" "}
                {date(token.last_used_at)}
              </small>
            </div>
            <button
              className="secondary-button danger-text"
              disabled={revoke.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Revoke “${token.name}”? Scripts using it will lose access.`,
                  )
                )
                  revoke.mutate(token.id);
              }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {tokens.isSuccess && !tokens.data.length && <p>No API tokens yet.</p>}
      <button
        className="secondary-button"
        onClick={() => {
          create.reset();
          setOpen(true);
        }}
      >
        Create API token
      </button>
      <Modal
        title="Create API token"
        description="Give scripts only the access they need, preferably to one project."
        open={open}
        onClose={() => setOpen(false)}
        pending={create.isPending}
      >
        <form onSubmit={submit}>
          <Field label="Token name">
            <input
              name="name"
              maxLength={80}
              required
              placeholder="Laptop training script"
            />
          </Field>
          <Field label="Project access">
            <select
              name="project_id"
              disabled={projects.isPending || projects.isError}
            >
              <option value="">Entire workspace</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <LoadState pending={projects.isPending} error={projects.error} />
          <fieldset className="scope-options">
            <legend>Permissions</legend>
            <label>
              <input
                type="checkbox"
                name="scopes"
                value="read"
                defaultChecked
              />{" "}
              Read records
            </label>
            <label>
              <input type="checkbox" name="scopes" value="write" /> Create,
              update and delete records
            </label>
            <label>
              <input
                type="checkbox"
                name="scopes"
                value="metrics:write"
                defaultChecked
              />{" "}
              Log metrics
            </label>
          </fieldset>
          <Field label="Expires in days">
            <input
              name="expires_days"
              type="number"
              min={1}
              max={365}
              defaultValue={90}
              required
            />
          </Field>
          <PasswordInput
            name="password"
            label="Current password"
            autoComplete="current-password"
          />
          {create.error && <ErrorNotice message={messageOf(create.error)} />}
          <SubmitButton
            pending={create.isPending}
            disabled={projects.isPending || projects.isError}
          >
            Create token
          </SubmitButton>
        </form>
      </Modal>
    </section>
  );
}

export function PortabilitySettings() {
  const qc = useQueryClient();
  const fileGeneration = useRef(0);
  const [data, setData] = useState<object | null>(null);
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const projects = useWorkspaceQuery<{ id: string; name: string }[]>({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api("/projects", { signal }),
  });
  const [projectId, setProjectId] = useState("");
  const exporting = useMutation({
    mutationFn: () =>
      api<object>(
        `/workspace/export${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`,
      ),
    onSuccess: (body) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `model-lab-${projectId ? "project" : "workspace"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "Export downloaded. Store the file privately; it contains your experiment data.",
      );
    },
  });
  const importing = useMutation({
    mutationFn: (dry_run: boolean) =>
      api<ImportPreview>("/workspace/import", {
        method: "POST",
        body: JSON.stringify({ data, dry_run }),
      }),
    onSuccess: (body) => {
      if (body.dryRun) setPreview(body);
      else {
        setPreview(null);
        setData(null);
        setFilename("");
        setMessage(
          "Import complete. Records were copied into new projects; existing records were preserved.",
        );
        void qc.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== "session",
        });
      }
    },
  });
  async function selectFile(file?: File) {
    const generation = ++fileGeneration.current;
    setData(null);
    setPreview(null);
    setError("");
    setMessage("");
    importing.reset();
    setFilename(file?.name || "");
    if (!file) return;
    if (file.size > 4_000_000) {
      setError(
        "Choose an export smaller than 4 MB. Export individual projects for larger workspaces.",
      );
      return;
    }
    try {
      const value: unknown = JSON.parse(await file.text());
      if (generation !== fileGeneration.current) return;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Choose a Model Lab JSON export.");
      setData(value);
    } catch (e) {
      if (generation === fileGeneration.current)
        setError(
          e instanceof SyntaxError
            ? "This file isn’t valid JSON."
            : messageOf(e),
        );
    }
  }
  return (
    <section className="panel settings-panel settings-wide">
      <h2>Export & import</h2>
      <p>
        Download an export for backup or transfer. Imports create new copies
        with new IDs and never overwrite existing projects. Account credentials
        and API tokens are excluded.
      </p>
      {message && (
        <p className="success-notice" role="status">
          {message}
        </p>
      )}
      {(error || exporting.error || importing.error) && (
        <ErrorNotice
          message={error || messageOf(exporting.error || importing.error)}
        />
      )}
      <div className="portability-grid">
        <div className="settings-subsection">
          <h3>Export data</h3>
          <Field label="Export scope">
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={projects.isPending}
            >
              <option value="">Entire workspace</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="secondary-button"
            disabled={exporting.isPending}
            onClick={() => {
              setMessage("");
              exporting.mutate();
            }}
          >
            {exporting.isPending ? "Preparing export…" : "Download JSON export"}
          </button>
        </div>
        <div className="settings-subsection">
          <h3>Import data</h3>
          <Field label="Model Lab JSON export">
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => void selectFile(event.target.files?.[0])}
              disabled={importing.isPending}
            />
          </Field>
          {filename && <p className="muted">{filename}</p>}
          <button
            className="secondary-button"
            disabled={!data || importing.isPending}
            onClick={() => {
              setPreview(null);
              importing.mutate(true);
            }}
          >
            Validate & preview import
          </button>
        </div>
      </div>
      {preview && (
        <div className="import-preview">
          <h3>Import preview</h3>
          <dl className="import-counts">
            {Object.entries(preview.counts).map(([key, count]) => (
              <div key={key}>
                <dt>{key.replaceAll("_", " ")}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <button
            className="primary-button"
            disabled={importing.isPending}
            onClick={() => importing.mutate(false)}
          >
            {importing.isPending
              ? "Importing…"
              : "Import these records as new copies"}
          </button>
        </div>
      )}
    </section>
  );
}
