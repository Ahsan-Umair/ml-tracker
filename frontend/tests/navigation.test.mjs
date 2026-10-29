import { test } from "node:test";
import assert from "node:assert/strict";
import { safeWorkspaceDestination } from "../src/lib/navigation.ts";

test("sign-in preserves resource and comparison deep links", () => {
  for (const path of [
    "/runs/run_example",
    "/models/mod_example?tab=versions",
    "/runs/compare?ids=a,b",
    "/projects/prj_example#experiments",
  ]) {
    assert.equal(safeWorkspaceDestination(path), path);
  }
});

test("sign-in rejects external and unrelated redirect destinations", () => {
  for (const path of [
    null,
    "",
    "//evil.example/runs",
    "https://evil.example/runs",
    "javascript:alert(1)",
    "/\\evil.example",
    "/login",
    "/api/auth/logout",
    "/runs/%2F%2Fevil.example",
  ]) {
    assert.equal(safeWorkspaceDestination(path), "/dashboard");
  }
});
