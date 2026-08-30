"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAuth, User } from "@/components/providers";
import { api, messageOf } from "@/lib/api";
import { ErrorNotice, Field, SubmitButton } from "@/components/ui";

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
            code to create your account. Your password is protected with Argon2id.
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
                autoFocus
              />
            </Field>
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field label="Private setup code" hint="Required for the hosted workspace. Leave blank only for local development.">
              <input name="setup_code" type="password" autoComplete="off" maxLength={256} placeholder="Your private setup code" />
            </Field>
            <div className="form-grid">
              <Field label="Password">
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="12+ characters"
                  minLength={12}
                  required
                />
              </Field>
              <Field label="Confirm">
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat password"
                  minLength={12}
                  required
                />
              </Field>
            </div>
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
