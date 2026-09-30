"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/components/providers";
import { PageHeading } from "@/components/ui";
import { RecoverySettings } from "@/components/recovery-settings";
export default function SettingsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <AppShell>
      <PageHeading
        eyebrow="Account & security"
        title="Settings"
        description="A clear view of your account and the protections around your workspace."
      />
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      <div className="settings-grid">
        <RecoverySettings />
        <section className="panel settings-panel">
          <h2>Profile</h2>
          <div className="settings-avatar">
            {user?.displayName
              .split(/\s+/)
              .map((x) => x[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <span>Name</span>
            <strong>{user?.displayName}</strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{user?.email}</strong>
          </div>
          <button
            className="secondary-button danger-text"
            onClick={() =>
              void logout()
                .then(() => router.push("/login"))
                .catch((e) => setError(e.message))
            }
          >
            <LogOut size={14} /> Sign out
          </button>
        </section>
        <section className="panel settings-panel">
          <h2>Your workspace, protected</h2>
          {[
            [
              LockKeyhole,
              "Private sign-in",
              "Your account credentials stay out of browser storage.",
            ],
            [
              KeyRound,
              "Protected password",
              "Your password is securely hashed, never stored as plain text.",
            ],
            [
              ShieldCheck,
              "Verified changes",
              "Only requests from your signed-in session can change your work.",
            ],
          ].map(([Icon, title, copy]) => (
            <div className="security-row" key={String(title)}>
              <span>
                <Icon size={16} />
              </span>
              <div>
                <strong>{String(title)}</strong>
                <small>{String(copy)}</small>
              </div>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
