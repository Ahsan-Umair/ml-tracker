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
  Search,
  ChevronRight,
} from "lucide-react";
import { Brand } from "./brand";
import { Modal } from "./ui";
import { useAuth, WorkspaceData } from "@/components/providers";
import { ThemeButton } from "@/components/theme";

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
  const [loggingOut, setLoggingOut] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const section = [...nav, ...insights].find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const detail = section && pathname !== section.href;
  const commands = [
    ...nav,
    ...insights,
    { label: "Compare runs", icon: ChartNoAxesCombined, href: "/runs/compare" },
  ].filter((item) =>
    item.label.toLowerCase().includes(commandQuery.toLowerCase().trim()),
  );
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandQuery("");
        setCommandOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => {
    document.title = `${detail ? "Details · " : ""}${section?.label || "Workspace"} · Model Lab`;
  }, [detail, section?.label]);
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
        <small>Connecting to your account and saved experiments…</small>
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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="nav-group-label">Workspace</div>
        <nav>
          {nav.map(({ label, icon: Icon, href }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-link ${pathname === href || pathname.startsWith(`${href}/`) ? "active" : ""}`}
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
              className={`nav-link ${pathname === href || pathname.startsWith(`${href}/`) ? "active" : ""}`}
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
      <main className="main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} />
            </button>
            <nav className="topbar-kicker breadcrumbs" aria-label="Breadcrumb">
              <Link href="/dashboard">Workspace</Link>
              <ChevronRight size={13} aria-hidden="true" />
              {detail && section ? (
                <>
                  <Link href={section.href}>{section.label}</Link>
                  <ChevronRight size={13} aria-hidden="true" />
                  <strong aria-current="page">
                    {pathname.endsWith("/compare") ? "Compare" : "Details"}
                  </strong>
                </>
              ) : (
                <strong aria-current="page">
                  {section?.label || "Overview"}
                </strong>
              )}
            </nav>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Search navigation"
              title="Search navigation (Ctrl+K or ⌘K)"
              onClick={() => {
                setCommandQuery("");
                setCommandOpen(true);
              }}
            >
              <Search size={18} />
            </button>
            <ThemeButton />
            <button
              className="icon-button"
              aria-label="Log out"
              disabled={loggingOut}
              onClick={() => {
                if (loggingOut) return;
                setLogoutError("");
                setLoggingOut(true);
                void logout()
                  .then(() => router.push("/login"))
                  .catch((e) => setLogoutError(e.message))
                  .finally(() => setLoggingOut(false));
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
        protectDraft={false}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      >
        <nav className="mobile-navigation">
          {[...nav, ...insights].map(({ label, icon: Icon, href }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-link ${pathname === href || pathname.startsWith(`${href}/`) ? "active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
      </Modal>
      <Modal
        title="Go to…"
        description="Search pages, then press Tab and Enter to open one. Shortcut: Ctrl+K or ⌘K."
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        protectDraft={false}
      >
        <label className="field">
          <span>Search navigation</span>
          <input
            autoFocus
            type="search"
            value={commandQuery}
            onChange={(event) => setCommandQuery(event.target.value)}
            placeholder="Runs, models, settings…"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget
                  .closest("dialog")
                  ?.querySelector<HTMLAnchorElement>("nav a")
                  ?.focus();
              }
            }}
          />
        </label>
        <nav className="command-list" aria-label="Navigation results">
          {commands.map(({ label, icon: Icon, href }) => (
            <Link key={href} href={href} onClick={() => setCommandOpen(false)}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        {!commands.length && (
          <p className="muted" role="status">
            No matching pages.
          </p>
        )}
      </Modal>
    </div>
  );
}
