"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeading } from "@/components/ui";
import { RecoverySettings } from "@/components/recovery-settings";
import {
  PasswordSettings,
  PortabilitySettings,
  ProfileSettings,
  SessionSettings,
  TokenSettings,
} from "@/components/account-settings";

export default function SettingsPage() {
  const [securityVersion, setSecurityVersion] = useState(0);
  return (
    <AppShell>
      <PageHeading
        eyebrow="Account & security"
        title="Settings"
        description="Manage your profile, sign-in security, automation access, and experiment data."
      />
      <div className="settings-grid">
        <ProfileSettings />
        <PasswordSettings
          onChanged={() => setSecurityVersion((value) => value + 1)}
        />
        <RecoverySettings key={`recovery-${securityVersion}`} />
        <section className="panel settings-panel">
          <h2>Workspace preferences</h2>
          <p>
            Use the theme button in the top bar to switch between light and
            dark. Press Ctrl+K or ⌘K to navigate quickly. Only your appearance
            preference is stored on this device.
          </p>
          <p>
            Your account uses secure session cookies and verified requests. Keep
            your recovery code and API tokens private.
          </p>
        </section>
        <SessionSettings key={`sessions-${securityVersion}`} />
        <TokenSettings key={`tokens-${securityVersion}`} />
        <PortabilitySettings />
      </div>
    </AppShell>
  );
}
