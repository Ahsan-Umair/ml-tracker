"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { api, messageOf, setCsrfToken, type ApiError } from "@/lib/api";

export type User = { id: string; email: string; displayName: string };
type Session = { user: User | null };
const sessionKey = ["session"];
type AuthValue = { user: User | null; loading: boolean; error: string; refresh: () => Promise<void>; setSession: (user: User, csrf: string) => void; logout: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }): Promise<Session> => {
      try { return await api<Session>("/auth/me", { signal }); }
      catch (error) {
        if ((error as ApiError).status === 401) return { user: null };
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
  function replaceSession(user: User | null, csrf: string) {
    void qc.cancelQueries();
    qc.removeQueries({ predicate: query => query.queryKey[0] !== "session" });
    qc.getMutationCache().clear();
    setCsrfToken(csrf);
    qc.setQueryData<Session>(sessionKey, { user });
  }
  const value: AuthValue = {
    user: session.data?.user ?? null,
    loading: session.isPending && !session.isError,
    error: session.isError ? messageOf(session.error) : "",
    refresh: async () => { await session.refetch(); },
    setSession: (user, csrf) => replaceSession(user, csrf),
    logout: async () => {
      try { await api<void>("/auth/logout", { method: "POST" }); }
      catch (error) { if ((error as ApiError).status !== 401) throw error; }
      replaceSession(null, "");
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [actionError, setActionError] = useState("");
  const [queryClient] = useState(() => {
    function expireSession(error: unknown) {
      if ((error as ApiError).status !== 401) return;
      setCsrfToken("");
      void client.cancelQueries();
      client.removeQueries({ predicate: query => query.queryKey[0] !== "session" });
      client.setQueryData<Session>(sessionKey, { user: null });
    }
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
      queryCache: new QueryCache({ onError: expireSession }),
      mutationCache: new MutationCache({
        onMutate: () => setActionError(""),
        onError: (error, _variables, _result, mutation) => {
          expireSession(error);
          if (!mutation.options.onError) setActionError(messageOf(error));
        },
        onSuccess: () => { void client.invalidateQueries({ predicate: query => query.queryKey[0] !== "session", refetchType: "none" }); },
      }),
    });
    return client;
  });
  return <QueryClientProvider client={queryClient}><AuthProvider>{children}
    {actionError && <div className="action-error" role="alert"><span>{actionError}</span><button className="secondary-button" onClick={() => setActionError("")}>Dismiss</button></div>}
  </AuthProvider></QueryClientProvider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside Providers");
  return value;
}

export function useWorkspaceQuery<T>(options: UseQueryOptions<T, Error, T, readonly string[]>) {
  const { user } = useAuth();
  return useQuery({ ...options, enabled: user ? options.enabled : false });
}

export function WorkspaceData({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  useSyncExternalStore(
    callback => cache.subscribe(callback),
    () => cache.getAll().filter(query => query.queryKey[0] !== "session" && query.isActive() && (query.state.status === "error" || query.state.status === "pending")).map(query => `${query.queryHash}:${query.state.errorUpdatedAt}:${query.state.fetchStatus}`).join("|"),
    () => "",
  );
  const failed = cache.getAll().filter(query => query.queryKey[0] !== "session" && query.isActive() && query.state.status === "error");
  if (failed.length) return <section className="panel connection-notice" role="alert"><h2>Couldn’t load your workspace</h2><p>{messageOf(failed[0].state.error)}</p><button className="primary-button" disabled={failed.some(query => query.state.fetchStatus === "fetching")} onClick={() => void qc.refetchQueries({ type: "active", predicate: query => query.state.status === "error" })}>Try again</button></section>;
  if (cache.getAll().some(query => query.queryKey[0] !== "session" && query.isActive() && query.state.status === "pending")) return <section className="connection-notice" role="status"><p>Loading your workspace…</p></section>;
  return children;
}
