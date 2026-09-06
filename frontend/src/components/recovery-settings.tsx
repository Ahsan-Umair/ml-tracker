"use client";

import { FormEvent, useState } from "react";
import { api, messageOf } from "@/lib/api";
import { ErrorNotice, SubmitButton } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { RecoveryCode, RecoveryResult } from "@/components/recovery-code";

export function RecoverySettings() {
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setPending(true); setError("");
    try { setResult(await api<RecoveryResult>("/auth/recovery-code", { method: "POST", body: JSON.stringify({ password: data.get("password") }) })); form.reset(); }
    catch (e) { setError(messageOf(e)); }
    finally { setPending(false); }
  }
  return <section className="panel settings-panel recovery-settings"><h2>Account recovery</h2>
    {result ? <RecoveryCode {...result} /> : <>
      <p>Save a private recovery code now so you can reset a forgotten password later. Creating a new code replaces your previous one.</p>
      <form className="auth-form" onSubmit={submit}>{error && <ErrorNotice message={error} />}<PasswordInput name="password" label="Current password" autoComplete="current-password" /><SubmitButton pending={pending}>Create recovery code</SubmitButton></form>
    </>}
  </section>;
}
