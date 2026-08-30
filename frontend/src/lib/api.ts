let csrfToken = "";

export type ApiError = Error & { status?: number };

export function setCsrfToken(value: string) { csrfToken = value; }

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch("/api/auth/csrf", { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Unable to establish a secure session");
  const body = await response.json();
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !path.endsWith("/login") && !path.endsWith("/register")) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: "include", cache: "no-store" });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail :
      Array.isArray(body.detail) ? body.detail.map((item: { msg?: string }) => item.msg || "Invalid field").join(". ") :
      response.status >= 500 ? "The server is waking up or temporarily unavailable. Please try again shortly." : "Something went wrong";
    const error = new Error(detail) as ApiError;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
