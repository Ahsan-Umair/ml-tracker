"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useAuth, User } from "@/components/providers";
import { api, messageOf } from "@/lib/api";
import { ErrorNotice, Field, SubmitButton } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { AuthFrame } from "@/components/auth-frame";
import { AuthPending } from "@/components/auth-pending";
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, setSession } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requested = params.get("next") || "/dashboard";
  const destination =
    /^\/(dashboard|projects|datasets|models|experiments|runs|leaderboard|analytics|settings)$/.test(
      requested,
    )
      ? requested
      : "/dashboard";
  useEffect(() => {
    if (user) router.replace(destination);
  }, [user, router, destination]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await api<{ user: User; csrfToken: string }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
          }),
        },
      );
      setSession(result.user, result.csrfToken);
      router.replace(destination);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      {error && <ErrorNotice message={error} />}
      <Field label="Email address">
        <input
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          required
        />
      </Field>
      <PasswordInput
        name="password"
        label="Password"
        autoComplete="current-password"
      />
      <div className="auth-form-meta">
        <span>
          <Check size={14} />
          Stay signed in on this device
        </span>
        <Link href="/recover">Forgot password?</Link>
      </div>
      <SubmitButton pending={pending} pendingLabel="Signing you in…">
        Open my workspace <ArrowRight size={17} />
      </SubmitButton>
      {pending && <AuthPending />}
      <div className="auth-divider" />
      <p className="auth-switch">
        First time here? <Link href="/register">Set up your workspace</Link>
      </p>
      <p className="auth-note">
        Private workspace. A setup code is required to join.
      </p>
    </form>
  );
}
export default function LoginPage() {
  return (
    <AuthFrame
      eyebrow="WELCOME BACK"
      title="A space for your next breakthrough."
      description="Sign in to pick up where your last experiment left off."
    >
      <Suspense fallback={<p role="status">Preparing your sign-in form…</p>}>
        <LoginForm />
      </Suspense>
    </AuthFrame>
  );
}
