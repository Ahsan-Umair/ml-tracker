"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAuth, User } from "@/components/providers";
import { api, messageOf } from "@/lib/api";
import { ErrorNotice, Field, SubmitButton } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export default function RegisterPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirm")) {
      setError("Passwords do not match");
      setPending(false);
      return;
    }
    try {
      const result = await api<{ user: User; csrfToken: string }>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            display_name: data.get("name"),
            email: data.get("email"),
            password: data.get("password"),
            registration_token: data.get("setup_code"),
          }),
        },
      );
      setSession(result.user, result.csrfToken);
      router.replace("/dashboard");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-showcase register-showcase">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          Model Lab
        </Link>
        <div className="auth-pitch">
          <p className="eyebrow">Start with a clean slate</p>
          <h1>Your experiments deserve better than scattered notes.</h1>
          <p>
            Build a durable record of what you tried, why you tried it, and
            which version actually won.
          </p>
        </div>
        <div className="auth-art" aria-hidden="true">
          <div className="art-card art-a">
            18 versions<small>across 6 active projects</small>
          </div>
          <div className="art-card art-b">
            +2.1% <small>latest accuracy uplift</small>
          </div>
          <div className="art-orbit" />
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <p className="eyebrow">Create your workspace</p>
          <h2>Start tracking smarter</h2>
          <p className="auth-copy">
            This is a private workspace. Use your owner email and private setup
            code to create your account.
          </p>
          <form className="auth-form" onSubmit={submit}>
            {error && <ErrorNotice message={error} />}
            <Field label="Name">
              <input
                name="name"
                autoComplete="name"
                placeholder="Ahsan Umair"
                minLength={2}
                required
              />
            </Field>
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field label="Private setup code" hint="The invitation code provided for this workspace.">
              <textarea name="setup_code" className="recovery-code-input" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} placeholder="Your private setup code" />
            </Field>
            <PasswordInput name="password" label="Password" autoComplete="new-password" minLength={12} hint="Use 12–128 characters. Save your password in your password manager." />
            <PasswordInput name="confirm" label="Confirm password" autoComplete="new-password" minLength={12} />
            <p className="password-help">If iCloud Passwords covers a field, press Esc to close its suggestion menu.</p>
            <SubmitButton pending={pending}>
              Create account <ArrowRight size={15} />
            </SubmitButton>
            <p className="auth-switch">
              Already have an account? <Link href="/login">Sign in</Link>
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
