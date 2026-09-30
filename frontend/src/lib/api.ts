let csrfToken = "";
let csrfRequest: Promise<string> | null = null;
let sessionGeneration = 0;

export type ApiError = Error & { status?: number; retryAfter?: number };

export function setCsrfToken(value: string) {
  sessionGeneration += 1;
  csrfToken = value;
  csrfRequest = null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const response = await fetch(`/api${path}`, {
      ...options, signal: controller.signal, credentials: "include", cache: "no-store",
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof body?.detail === "string" ? body.detail :
        Array.isArray(body?.detail) ? body.detail.map((item: { msg?: string }) => item.msg || "Invalid field").join(". ") :
        response.status === 429 ? "The service is temporarily busy. Please wait a minute and try again." :
        response.status >= 500 ? "The server is waking up or temporarily unavailable. Please try again shortly." :
        response.status === 401 ? "Your session has expired. Please sign in again." :
        "The request could not be completed. Please try again.";
      const error: ApiError = new Error(detail);
      error.status = response.status;
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(milliseconds)) error.retryAfter = Math.max(0, milliseconds);
      }
      throw error;
    }
    if (body === null) throw new Error("The server returned an unexpected response. Please try again shortly.");
    return body as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (controller.signal.aborted) throw new Error("The server took too long to respond. Please try again shortly.");
    if (error instanceof TypeError) throw new Error("Could not reach the server. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    const generation = sessionGeneration;
    const pending = request<{ csrfToken: string }>("/auth/csrf").then(body => {
      if (generation !== sessionGeneration) throw new Error("Your session changed. Please try again.");
      csrfToken = body.csrfToken;
      return csrfToken;
    });
    csrfRequest = pending;
    void pending.finally(() => { if (csrfRequest === pending) csrfRequest = null; }).catch(() => {});
  }
  return csrfRequest;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !["/auth/login", "/auth/register", "/auth/recover"].includes(path)) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }
  return request<T>(path, { ...options, headers });
}

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
