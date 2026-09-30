"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useAuth, User } from "@/components/providers";
import { api, messageOf } from "@/lib/api";
import { ErrorNotice, Field, SubmitButton } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { AuthFrame } from "@/components/auth-frame";
import { AuthPending } from "@/components/auth-pending";
export default function RegisterPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget);
    if (data.get("password") !== data.get("confirm")) {
      setError("Passwords do not match. Please try again.");
      return;
    }
    setPending(true);
    try {
      const result = await api<{ user: User; csrfToken: string }>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            display_name: name,
            email,
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
    <AuthFrame
      eyebrow="MAKE ROOM FOR YOUR IDEAS"
      title={
        step === 1
          ? "Start your research workspace."
          : "Make it yours. Keep it private."
      }
      description={
        step === 1
          ? "One place for your models, experiments, and progress."
          : "Use your private setup code and choose a strong password."
      }
    >
      <ol className="auth-steps">
        <li aria-current={step === 1 ? "step" : undefined}>
          <span>1</span>Your details
        </li>
        <li aria-current={step === 2 ? "step" : undefined}>
          <span>2</span>Secure access
        </li>
      </ol>
      {step === 1 ? (
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            setStep(2);
          }}
        >
          <Field label="Your name">
            <input
              autoComplete="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={100}
              placeholder="Full name"
              required
            />
          </Field>
          <Field label="Owner email address">
            <input
              type="email"
              autoComplete="username"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </Field>
          <p className="auth-note">
            This is a private workspace. Registration is limited to its owner.
          </p>
          <button className="primary-button" type="submit">
            Continue <ArrowRight size={17} />
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {error && <ErrorNotice message={error} />}
          <div className="account-summary">
            <div>
              <strong>{name}</strong>
              <span>{email}</span>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setStep(1);
                setError("");
              }}
            >
              Edit
            </button>
          </div>
          <input
            className="sr-only"
            name="email"
            type="email"
            value={email}
            readOnly
            autoComplete="username"
            tabIndex={-1}
            aria-label="Account email"
          />
          <Field
            label="Private setup code"
            hint="The invitation code for this workspace."
          >
            <input
              name="setup_code"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={256}
              autoFocus
            />
          </Field>
          <PasswordInput
            name="password"
            label="Create password"
            autoComplete="new-password"
            minLength={12}
            hint="Use 12–128 characters. A password manager can help."
          />
          <PasswordInput
            name="confirm"
            label="Confirm password"
            autoComplete="new-password"
            minLength={12}
          />
          <SubmitButton
            pending={pending}
            pendingLabel="Creating your workspace…"
          >
            Create my workspace <ArrowRight size={17} />
          </SubmitButton>
          {pending && <AuthPending />}
        </form>
      )}
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
