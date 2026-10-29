"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const preferenceKey = "model-lab-theme-v1";
const preferenceEvent = "model-lab-theme-change";
let memoryPreference: Theme | null = null;

function currentTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(preferenceKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Appearance still works when storage is unavailable. */
  }
  if (memoryPreference) return memoryPreference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", callback);
  window.addEventListener(preferenceEvent, callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(preferenceEvent, callback);
    media.removeEventListener("change", callback);
  };
}

function useTheme() {
  return useSyncExternalStore(subscribe, currentTheme, () => "light" as Theme);
}

export function ThemeInitializer() {
  const theme = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
}

export function ThemeButton() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  function changeTheme() {
    memoryPreference = next;
    try {
      window.localStorage.setItem(preferenceKey, next);
    } catch {
      /* In-memory fallback. */
    }
    window.dispatchEvent(new Event(preferenceEvent));
  }
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Use ${next} theme`}
      title={`Use ${next} theme`}
      onClick={changeTheme}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
