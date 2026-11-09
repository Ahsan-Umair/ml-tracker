/* eslint-disable @typescript-eslint/no-require-imports -- Matches the CommonJS browser test runner. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");

const baseURL = process.env.BASE_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname))
  throw new Error("Prerequisite checks require an isolated local deployment.");

test("missing prerequisites disable submission while keeping resource forms closable", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const context = await browser.newContext({ baseURL });
    const registration = await context.request.post("/api/auth/register", {
      data: {
        display_name: "Prerequisite Researcher",
        email: `prerequisite-${randomUUID()}@example.com`,
        password: "local-prerequisite-passphrase",
      },
    });
    assert.equal(registration.status(), 201);
    const page = await context.newPage();
    for (const [path, action, submit, prerequisite] of [
      ["/models", "Register model", "Create model", "a project"],
      ["/datasets", "Register dataset", "Create dataset reference", "a project"],
      ["/experiments", "New experiment", "Create experiment", "a project"],
      ["/runs", "Log a run", "Create run", "an experiment"],
    ]) {
      await page.goto(path);
      await page.getByRole("button", { name: action, exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText(new RegExp(`Create ${prerequisite} first`)).waitFor();
      const button = dialog.getByRole("button", { name: submit, exact: true });
      assert.equal(await button.isEnabled(), false);
      assert.equal(await button.getAttribute("aria-busy"), "false");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
