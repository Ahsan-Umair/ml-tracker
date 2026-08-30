"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setCsrfToken } from "@/lib/api";

export type User = { id: string; email: string; displayName: string };
type AuthValue = { user: User | null; loading: boolean; refresh: () => Promise<void>; setSession: (user: User, csrf: string) => void; logout: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User }>("/auth/me");
      setUser(data.user);
    } catch { setUser(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    api<{ user: User }>("/auth/me")
      .then((data) => { if (active) setUser(data.user); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const value = useMemo<AuthValue>(() => ({
    user, loading, refresh,
    setSession: (next, csrf) => { setCsrfToken(csrf); setUser(next); setLoading(false); },
    logout: async () => { await api<void>("/auth/logout", { method: "POST" }); setCsrfToken(""); setUser(null); },
  }), [user, loading, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={queryClient}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside Providers");
  return value;
}
