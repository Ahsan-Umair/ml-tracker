"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, KeyRound, Sparkles } from "lucide-react";
import { api, messageOf, setCsrfToken } from "@/lib/api";
import { ErrorNotice, Field, SubmitButton } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { RecoveryCode, RecoveryResult } from "@/components/recovery-code";
import { useAuth } from "@/components/providers";

export default function RecoverPage() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [saved, setSaved] = useState(false);
  const { refresh } = useAuth();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("password") !== data.get("confirm")) { setError("Passwords do not match."); return; }
    setPending(true);
    try {
      const next = await api<RecoveryResult>("/auth/recover", { method: "POST", body: JSON.stringify({ email, recovery_code: code.trim(), password: data.get("password") }) });
      form.reset(); setCode(""); setCsrfToken(""); setResult(next);
      void refresh();
    } catch (e) { setError(messageOf(e)); }
    finally { setPending(false); }
  }

  return <main className="auth-page">
    <section className="auth-showcase">
      <Link href="/login" className="brand"><span className="brand-mark"><Sparkles size={18} /></span>Model Lab</Link>
      <div className="auth-pitch"><p className="eyebrow">Account recovery</p><h1>Back to your lab.</h1><p>Choose a new password and keep your models, experiments, and metrics.</p><div className="auth-proof"><span><KeyRound size={16} />Private recovery code</span></div></div>
    </section>
    <section className="auth-panel"><div className="auth-box">
      <p className="eyebrow">{result ? "Password updated" : `Step ${step} of 2`}</p>
      <h2>{result ? "Your account is recovered" : step === 1 ? "Recover your account" : "Choose a new password"}</h2>
      {result ? <div className="auth-form">
        <p className="auth-copy" role="status">Your data is safe. All previous sessions have been signed out. Use your new password to sign in.</p>
        <RecoveryCode {...result} />
        <label className="recovery-saved"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />I saved my new recovery code.</label>
        {saved ? <Link className="primary-button recovery-continue" href="/login">Continue to sign in <ArrowRight size={16} /></Link> : <button className="primary-button" disabled>Save your code to continue</button>}
      </div> : step === 1 ? <>
        <p className="auth-copy">Enter your account email and recovery code. This is separate from the invitation code used to register.</p>
        <form className="auth-form" onSubmit={e => { e.preventDefault(); setError(""); setStep(2); }}>
          <Field label="Email"><input name="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
          <Field label="Recovery code"><textarea className="recovery-code-input" name="recovery_code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} value={code} onChange={e => setCode(e.target.value)} required /></Field>
          <button className="primary-button" type="submit">Continue <ArrowRight size={16} /></button>
          <details className="recovery-help"><summary>Don’t have a recovery code?</summary><p>If you’re signed in on another device, create one in Settings using your current password. Otherwise, use your Render account to issue an emergency code. Recovery email is not enabled.</p></details>
          <p className="auth-switch"><Link href="/login">Back to sign in</Link></p>
        </form>
      </> : <>
        <p className="auth-copy">Resetting the password signs out all devices. Your recovery code will be checked when you submit.</p>
        <form className="auth-form" onSubmit={submit}>
          {error && <ErrorNotice message={error} />}
          <input type="email" name="email" autoComplete="username" value={email} readOnly className="sr-only" tabIndex={-1} aria-label="Account email" />
          <PasswordInput name="password" label="New password" autoComplete="new-password" minLength={12} hint="Use 12–128 characters. You can save this password in iCloud Passwords." />
          <PasswordInput name="confirm" label="Confirm new password" autoComplete="new-password" minLength={12} />
          <p className="password-help">If password suggestions cover a field, press Esc to close the menu.</p>
          <SubmitButton pending={pending}>Reset password <ArrowRight size={16} /></SubmitButton>
          <button className="auth-back" type="button" disabled={pending} onClick={() => { setStep(1); setError(""); }}><ArrowLeft size={14} />Change email or recovery code</button>
        </form>
      </>}
    </div></section>
  </main>;
}
