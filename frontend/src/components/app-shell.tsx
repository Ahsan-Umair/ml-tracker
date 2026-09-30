"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Boxes,
  BrainCircuit,
  ChartNoAxesCombined,
  Database,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Play,
  Settings2,
  Menu,
  Trophy,
} from "lucide-react";
import { Brand } from "./brand";
import { Modal } from "./ui";
import { useAuth, WorkspaceData } from "@/components/providers";

const nav = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Projects", icon: Boxes, href: "/projects" },
  { label: "Models", icon: BrainCircuit, href: "/models" },
  { label: "Experiments", icon: FlaskConical, href: "/experiments" },
  { label: "Runs", icon: Play, href: "/runs" },
  { label: "Datasets", icon: Database, href: "/datasets" },
];
const insights = [
  { label: "Leaderboard", icon: Trophy, href: "/leaderboard" },
  { label: "Analytics", icon: ChartNoAxesCombined, href: "/analytics" },
  { label: "Settings", icon: Settings2, href: "/settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, error, refresh, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    if (!loading && !error && !user)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, error, user, router, pathname]);
  if (error)
    return (
      <div className="loading-screen" role="alert">
        <h2>Unable to connect</h2>
        <p>{error}</p>
        <button className="primary-button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  if (loading || !user)
    return (
      <div className="loading-screen">
        <Brand href="/login" />
        <p>Opening your workspace…</p>
        <small>
          The server may take about a minute to wake after inactivity.
        </small>
      </div>
    );
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="nav-group-label">Workspace</div>
        <nav>
          {nav.map(({ label, icon: Icon, href }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-link ${pathname === href ? "active" : ""}`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="nav-group-label">Insights</div>
        <nav>
          {insights.map(({ label, icon: Icon, href }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-link ${pathname === href ? "active" : ""}`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <button
          className="sidebar-profile"
          onClick={() => router.push("/settings")}
        >
          <div className="avatar">{initials}</div>
          <div className="profile-copy">
            <div className="run-name">{user.displayName}</div>
            <div className="run-meta">Personal workspace</div>
          </div>
        </button>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div className="topbar-kicker">
              Workspace <span>/</span>{" "}
              <strong>
                {[...nav, ...insights].find((item) => item.href === pathname)
                  ?.label || "Overview"}
              </strong>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Log out"
              onClick={() => {
                setLogoutError("");
                void logout()
                  .then(() => router.push("/login"))
                  .catch((e) => setLogoutError(e.message));
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        {logoutError && (
          <p className="error-notice" role="alert">
            {logoutError}
          </p>
        )}
        <WorkspaceData>{children}</WorkspaceData>
      </main>
      <Modal
        title="Your workspace"
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      >
        <nav className="mobile-navigation">
          {[...nav, ...insights].map(({ label, icon: Icon, href }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-link ${pathname === href ? "active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
      </Modal>
    </div>
  );
}
