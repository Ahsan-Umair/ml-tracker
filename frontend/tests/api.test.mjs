import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, setCsrfToken } from "../src/lib/api.ts";

const originalFetch = globalThis.fetch;
const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
afterEach(() => { globalThis.fetch = originalFetch; setCsrfToken(""); });

test("plain upstream rate limits preserve status and a useful error without retrying a write", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "60" } }); };
  await assert.rejects(api("/auth/login", { method: "POST", body: "{}" }), error => error.status === 429 && error.retryAfter === 60000 && /wait a minute/.test(error.message));
  assert.equal(calls, 1);
});

test("concurrent writes share one CSRF refresh and keep credentials first-party", async () => {
  const calls = [];
  let resolveCsrf;
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    if (url === "/api/auth/csrf") return new Promise(resolve => { resolveCsrf = resolve; });
    return Promise.resolve(json({ ok: true }));
  };
  const writes = [api("/projects", { method: "POST", body: "{}" }), api("/models/one/status", { method: "PATCH", body: "{}" })];
  assert.equal(calls.length, 1);
  resolveCsrf(json({ csrfToken: "session-csrf" }));
  await Promise.all(writes);
  assert.equal(calls.length, 3);
  for (const call of calls.slice(1)) {
    assert.equal(call.options.headers.get("X-CSRF-Token"), "session-csrf");
    assert.equal(call.options.credentials, "include");
  }
});

test("a CSRF response from a previous session cannot authorize a write", async () => {
  let resolveCsrf;
  let writes = 0;
  globalThis.fetch = url => url === "/api/auth/csrf" ? new Promise(resolve => { resolveCsrf = resolve; }) : (writes++, Promise.resolve(json({ ok: true })));
  const pending = api("/projects", { method: "POST", body: "{}" });
  setCsrfToken("new-session-csrf");
  resolveCsrf(json({ csrfToken: "old-session-csrf" }));
  await assert.rejects(pending, /session changed/);
  assert.equal(writes, 0);
});

test("failed CSRF refresh can be retried explicitly", async () => {
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(api("/projects", { method: "POST" }), /server is waking up/);
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return json(url.endsWith("/csrf") ? { csrfToken: "valid" } : { ok: true }); };
  await api("/projects", { method: "POST" });
  assert.deepEqual(calls, ["/api/auth/csrf", "/api/projects"]);
});

test("network failures and malformed success responses are actionable", async () => {
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(api("/dashboard"), /Check your connection/);
  globalThis.fetch = async () => new Response("<html>proxy error</html>");
  await assert.rejects(api("/dashboard"), /unexpected response/);
});

test("aborted reads stay cancelled and successful deletes accept empty bodies", async () => {
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async (_url, options) => { options.signal.throwIfAborted(); return json({}); };
  await assert.rejects(api("/dashboard", { signal: controller.signal }), error => error.name === "AbortError");
  setCsrfToken("valid");
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await api("/projects/one", { method: "DELETE" }), undefined);
});
