/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS keeps the node:test browser harness independent of app module settings. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");

const baseURL = process.env.BASE_URL || "http://localhost:3000";
const origin = new URL(baseURL).origin;
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname) &&
  process.env.ALLOW_REMOTE_E2E !== "1"
) {
  throw new Error(
    "Account e2e tests create records. Use a local test server, or explicitly set ALLOW_REMOTE_E2E=1 for an isolated remote test environment.",
  );
}

test(
  "account settings, security, portability and navigation work together",
  { timeout: 180_000 },
  async (t) => {
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    const context = await browser.newContext({
      baseURL,
      acceptDownloads: true,
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(20_000);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const suffix = randomUUID().replaceAll("-", "");
    const email = `account-${suffix}@example.com`;
    let password = `Local-test-${suffix}`;
    let csrf;
    let projectId;
    let apiToken;
    let secondContext;
    const section = (name) =>
      page
        .locator("section.settings-panel")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });

    try {
      await t.test(
        "registers a fresh isolated account and opens settings",
        async () => {
          const response = await context.request.post("/api/auth/register", {
            headers: { Origin: origin },
            data: { display_name: "Account E2E Owner", email, password },
          });
          assert.equal(
            response.status(),
            201,
            "local test account registration succeeds",
          );
          csrf = (await response.json()).csrfToken;
          const project = await context.request.post("/api/projects", {
            headers: { Origin: origin, "X-CSRF-Token": csrf },
            data: { name: "Account E2E Project" },
          });
          assert.equal(project.status(), 201);
          projectId = (await project.json()).id;
          await page.route(
            "**/api/auth/tokens",
            (route) =>
              route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ detail: "Temporary test outage" }),
              }),
            { times: 1 },
          );
          await page.goto("/settings");
          await page
            .getByRole("heading", { name: "Settings", exact: true })
            .waitFor();
          await section("Profile").getByLabel("Display name").waitFor();
          await page
            .getByText("Some workspace data couldn’t load", { exact: true })
            .waitFor();
          await page
            .getByRole("button", { name: "Try again", exact: true })
            .click();
          await section("API tokens")
            .getByText("No API tokens yet.", { exact: true })
            .waitFor();
        },
      );

      await t.test(
        "edits profile without losing the signed-in session",
        async () => {
          const profile = section("Profile");
          await profile.getByLabel("Display name").fill("Updated E2E Owner");
          await profile.getByRole("button", { name: "Save profile" }).click();
          await profile.getByText("Profile saved.", { exact: true }).waitFor();
          assert.equal(
            (await (await context.request.get("/api/auth/me")).json()).user
              .displayName,
            "Updated E2E Owner",
          );
        },
      );

      await t.test(
        "preserves a token draft when closing is cancelled",
        async () => {
          const tokens = section("API tokens");
          await tokens
            .getByRole("button", { name: "Create API token", exact: true })
            .click();
          const modal = page.getByRole("dialog", {
            name: "Create API token",
            exact: true,
          });
          await modal.getByLabel("Token name").fill("E2E notebook");
          await modal.getByLabel("Project access").selectOption(projectId);
          const dismiss = (dialog) => dialog.dismiss();
          page.once("dialog", dismiss);
          await modal
            .getByRole("button", { name: "Close", exact: true })
            .click();
          assert.equal(
            await modal.getByLabel("Token name").inputValue(),
            "E2E notebook",
          );
          assert.equal(
            await page
              .getByRole("heading", { name: "Settings", exact: true })
              .count(),
            1,
          );
          await modal
            .getByLabel("Current password", { exact: true })
            .fill(password);
          await modal
            .getByRole("button", { name: "Create token", exact: true })
            .click();
          const output = tokens.getByLabel("New API token", { exact: true });
          await output.waitFor();
          apiToken = await output.inputValue();
          assert.ok(
            apiToken.startsWith("ml_"),
            "opaque API token is returned once",
          );
          await tokens
            .getByRole("button", { name: "I saved it — hide", exact: true })
            .click();
          assert.equal(
            await tokens.getByLabel("New API token", { exact: true }).count(),
            0,
          );
        },
      );

      await t.test(
        "downloads exports and previews imports before copying records",
        async () => {
          const portability = section("Export & import");
          await portability.getByLabel("Export scope").selectOption(projectId);
          const download = page.waitForEvent("download");
          await portability
            .getByRole("button", { name: "Download JSON export", exact: true })
            .click();
          assert.match(
            (await download).suggestedFilename(),
            /^model-lab-project-.*\.json$/,
          );
          const exported = await context.request.get(
            `/api/workspace/export?project_id=${encodeURIComponent(projectId)}`,
          );
          assert.equal(exported.status(), 200);
          const data = await exported.json();
          assert.equal(data.projects.length, 1);
          assert.ok(!Object.hasOwn(data, "users"));
          await portability
            .getByLabel("Model Lab JSON export", { exact: true })
            .setInputFiles({
              name: "local-test-export.json",
              mimeType: "application/json",
              buffer: Buffer.from(JSON.stringify(data)),
            });
          await portability
            .getByRole("button", {
              name: "Validate & preview import",
              exact: true,
            })
            .click();
          await portability
            .getByRole("heading", { name: "Import preview", exact: true })
            .waitFor();
          const before = await (
            await context.request.get("/api/projects")
          ).json();
          assert.equal(before.length, 1, "preview does not write records");
          await portability
            .getByRole("button", {
              name: "Import these records as new copies",
              exact: true,
            })
            .click();
          await portability
            .getByText(
              "Import complete. Records were copied into new projects; existing records were preserved.",
              { exact: true },
            )
            .waitFor();
          const after = await (
            await context.request.get("/api/projects")
          ).json();
          assert.equal(after.length, 2);
          assert.equal(new Set(after.map((project) => project.id)).size, 2);
        },
      );

      await t.test(
        "changes password and revokes another session and API tokens",
        async () => {
          secondContext = await browser.newContext({ baseURL });
          const second = await secondContext.request.post("/api/auth/login", {
            headers: { Origin: origin },
            data: { email, password },
          });
          assert.equal(second.status(), 200);
          const newPassword = `Updated-${suffix}-passphrase`;
          const form = section("Change password");
          await form
            .getByLabel("Current password", { exact: true })
            .fill(password);
          await form
            .getByLabel("New password", { exact: true })
            .fill(newPassword);
          await form
            .getByLabel("Confirm new password", { exact: true })
            .fill(newPassword);
          await form
            .getByRole("button", { name: "Update password", exact: true })
            .click();
          await form
            .getByText("Password updated. This session remains signed in.", {
              exact: true,
            })
            .waitFor();
          password = newPassword;
          assert.equal(
            (await context.request.get("/api/auth/me")).status(),
            200,
          );
          assert.equal(
            (await secondContext.request.get("/api/auth/me")).status(),
            401,
          );
          assert.equal(
            (
              await context.request.get("/api/projects", {
                headers: { Authorization: `Bearer ${apiToken}` },
              })
            ).status(),
            401,
          );
          await section("Signed-in sessions")
            .getByText("This session", { exact: true })
            .waitFor();
          assert.equal(
            await section("Signed-in sessions")
              .getByText("Other session", { exact: true })
              .count(),
            0,
          );
        },
      );

      await t.test(
        "supports theme, command navigation and a mobile menu",
        async () => {
          const before = await page.locator("html").getAttribute("data-theme");
          await page
            .getByRole("button", { name: /Use (dark|light) theme/ })
            .click();
          await page.waitForFunction(
            (previous) => document.documentElement.dataset.theme !== previous,
            before,
          );
          const changed = await page.locator("html").getAttribute("data-theme");
          await page.reload();
          await page
            .getByRole("heading", { name: "Settings", exact: true })
            .waitFor();
          await page.waitForFunction(
            (theme) => document.documentElement.dataset.theme === theme,
            changed,
          );
          await page
            .getByRole("button", { name: "Search navigation", exact: true })
            .click();
          const command = page.getByRole("dialog", {
            name: "Go to…",
            exact: true,
          });
          await command
            .getByLabel("Search navigation", { exact: true })
            .fill("projects");
          await command
            .getByRole("link", { name: "Projects", exact: true })
            .click();
          await page.waitForURL("**/projects");
          await page.setViewportSize({ width: 390, height: 844 });
          await page
            .getByRole("button", { name: "Open navigation", exact: true })
            .click();
          const menu = page.getByRole("dialog", {
            name: "Your workspace",
            exact: true,
          });
          await menu
            .getByRole("link", { name: "Settings", exact: true })
            .click();
          await page.waitForURL("**/settings");
          assert.ok(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            "settings fit the mobile viewport",
          );
        },
      );

      await t.test(
        "signs out and signs back in through the actual form",
        async () => {
          await page
            .getByRole("button", { name: "Log out", exact: true })
            .click();
          await page.waitForURL((url) => url.pathname === "/login");
          const returnPath =
            new URL(page.url()).searchParams.get("next") || "/dashboard";
          await page.getByLabel("Email address", { exact: true }).fill(email);
          await page.getByLabel("Password", { exact: true }).fill(password);
          await page.getByRole("button", { name: "Open my workspace" }).click();
          await page.waitForURL((url) => url.pathname === returnPath);
          assert.deepEqual(errors, [], "no client-side runtime errors");
        },
      );
    } finally {
      await secondContext?.close();
      await context.close();
      await browser.close();
    }
  },
);
