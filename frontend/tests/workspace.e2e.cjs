/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS enables bundled Playwright resolution through NODE_PATH. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { chromium } = require("playwright");
const baseURL = process.env.BASE_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname))
  throw new Error("Workspace E2E tests require an isolated local deployment.");
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
});
after(async () => {
  await browser?.close();
});

async function session(viewport) {
  const context = await browser.newContext({
    baseURL,
    viewport: viewport || { width: 1440, height: 1000 },
  });
  const reply = await context.request.post("/api/auth/register", {
    data: {
      display_name: "E2E Researcher",
      email: `e2e-${randomUUID()}@example.com`,
      password: "local-e2e-only-passphrase",
    },
  });
  assert.equal(reply.status(), 201, "isolated test account registration");
  const { csrfToken } = await reply.json();
  async function write(path, data, method = "post") {
    const response = await context.request[method](`/api${path}`, {
      data,
      headers: { "X-CSRF-Token": csrfToken, Origin: new URL(baseURL).origin },
    });
    assert.ok(response.ok(), `${method} ${path} -> ${response.status()}`);
    return response.status() === 204 ? undefined : response.json();
  }
  return { context, page: await context.newPage(), write };
}

async function openCreate(page, label) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  return page.getByRole("dialog");
}

async function submitAndClose(dialog, label) {
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

test(
  "research workflow creates and edits each resource, inspects metrics, compares runs, and previews cascade deletion",
  { timeout: 180000 },
  async () => {
    const { context, page, write } = await session();
    try {
      const clientErrors = [];
      page.on("pageerror", (error) => clientErrors.push(error.message));
      await page.goto("/projects");
      let dialog = await openCreate(page, "New project");
      await dialog.getByLabel("Name", { exact: true }).fill("Vision E2E");
      await dialog
        .getByLabel("Description", { exact: true })
        .fill("Project created through the browser");
      await dialog.getByLabel("Tags", { exact: true }).fill("vision, baseline");
      await submitAndClose(dialog, "Create project");
      await page.getByRole("link", { name: "Vision E2E", exact: true }).click();
      await page.waitForURL(/\/projects\/prj_/);
      assert.match(page.url(), /\/projects\/prj_/);
      const projectId = new URL(page.url()).pathname.split("/").at(-1);
      await page
        .getByRole("heading", { name: "Vision E2E", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Edit project", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Description", { exact: true })
        .fill("Edited project description");
      await submitAndClose(dialog, "Save changes");
      await page
        .getByText("Edited project description", { exact: true })
        .waitFor();

      await page.goto("/datasets");
      dialog = await openCreate(page, "Register dataset");
      await dialog
        .getByLabel("Project", { exact: true })
        .selectOption(projectId);
      await dialog.getByLabel("Name", { exact: true }).fill("CIFAR E2E");
      await dialog
        .getByLabel("URI or path", { exact: true })
        .fill("https://example.com/dataset.parquet");
      await submitAndClose(dialog, "Create dataset reference");
      await page.getByRole("link", { name: "CIFAR E2E", exact: true }).click();
      await page.waitForURL(/\/datasets\/dat_/);
      await page
        .getByRole("heading", { name: "CIFAR E2E", exact: true })
        .waitFor();
      const datasetId = new URL(page.url()).pathname.split("/").at(-1);
      assert.match(datasetId, /^dat_/);

      await page.goto("/models");
      dialog = await openCreate(page, "Register model");
      await dialog
        .getByLabel("Project", { exact: true })
        .selectOption(projectId);
      await dialog.getByLabel("Name", { exact: true }).fill("Classifier E2E");
      await submitAndClose(dialog, "Create model");
      await page
        .getByRole("link", { name: "Classifier E2E", exact: true })
        .click();
      await page.waitForURL(/\/models\/mod_/);
      const modelId = new URL(page.url()).pathname.split("/").at(-1);
      await page
        .getByRole("button", { name: "Register version", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("Version", { exact: true }).fill("v1");
      await dialog
        .getByLabel("Artifact URI", { exact: true })
        .fill("https://example.com/model.bin");
      await submitAndClose(dialog, "Register version");
      await page.getByLabel("Stage of v1").selectOption("staging");
      await page.waitForFunction(
        () =>
          document.querySelector('select[aria-label="Stage of v1"]')?.value ===
          "staging",
      );

      await page.goto("/experiments");
      dialog = await openCreate(page, "New experiment");
      await dialog
        .getByLabel("Project", { exact: true })
        .selectOption(projectId);
      await dialog.getByLabel("Name", { exact: true }).fill("Augmentation E2E");
      await dialog
        .getByLabel("Dataset", { exact: true })
        .selectOption(datasetId);
      await dialog.getByLabel("Model", { exact: true }).selectOption(modelId);
      await dialog
        .getByLabel("Primary metric", { exact: true })
        .fill("val_accuracy");
      await submitAndClose(dialog, "Create experiment");
      await page
        .getByRole("link", { name: "Augmentation E2E", exact: true })
        .click();
      await page.waitForURL(/\/experiments\/exp_/);
      const experimentId = new URL(page.url()).pathname.split("/").at(-1);
      await page
        .getByRole("heading", { name: "Evaluation protocol", exact: true })
        .waitFor();
      // A metadata save must preserve linked records even before their lookup
      // options arrive in an edit form after a cold page load.
      let releaseLookups;
      const lookupsBlocked = new Promise((resolve) => {
        releaseLookups = resolve;
      });
      for (const path of [
        "**/api/models?limit=500",
        "**/api/datasets?limit=500",
      ]) {
        await page.route(
          path,
          async (route) => {
            await lookupsBlocked;
            await route.continue();
          },
          { times: 1 },
        );
      }
      try {
        await page.reload();
        await page
          .getByRole("button", { name: "Edit experiment", exact: true })
          .click();
        dialog = page.getByRole("dialog");
        await dialog
          .getByLabel("Description", { exact: true })
          .fill("Edited before linked lookup options arrived");
        await submitAndClose(dialog, "Save changes");
        const retained = await (
          await context.request.get(`/api/experiments/${experimentId}`)
        ).json();
        assert.equal(retained.dataset_id, datasetId);
        assert.equal(retained.model_id, modelId);
      } finally {
        releaseLookups();
      }

      await page.goto(`/runs?experiment_id=${experimentId}`);
      dialog = await openCreate(page, "Log a run");
      await dialog
        .getByLabel("Experiment", { exact: true })
        .selectOption(experimentId);
      await dialog.getByLabel("Name", { exact: true }).fill("Browser baseline");
      await submitAndClose(dialog, "Create run");
      await page
        .getByRole("link", { name: "Browser baseline", exact: true })
        .click();
      await page.waitForURL(/\/runs\/run_/);
      const runId = new URL(page.url()).pathname.split("/").at(-1);
      await page
        .getByRole("heading", { name: "Hyperparameters", exact: true })
        .waitFor();
      dialog = await openCreate(page, "Log metric");
      await dialog.getByLabel("Value", { exact: true }).fill("0.92");
      await dialog.getByLabel("Step / epoch", { exact: true }).fill("1");
      await submitAndClose(dialog, "Save reading");
      await page.getByRole("img", { name: /Metric values by step/ }).waitFor();
      await page
        .getByLabel("Run status", { exact: true })
        .selectOption("completed");
      const second = await write("/runs", {
        experiment_id: experimentId,
        name: "SDK candidate",
        status: "completed",
        hyperparameters: { seed: 7 },
      });
      await write(`/runs/${second.id}/metrics`, {
        name: "val_accuracy",
        value: 0.95,
        step: 1,
        unit: "fraction",
        split: "validation",
      });
      await page.goto(`/runs/compare?ids=${runId},${second.id}`);
      await page
        .getByRole("heading", { name: "Compare runs", exact: true })
        .waitFor();
      await page
        .getByRole("columnheader", { name: "Browser baseline", exact: true })
        .waitFor();
      await page
        .getByRole("columnheader", { name: "SDK candidate", exact: true })
        .waitFor();
      await page.getByText("Parameter · seed", { exact: true }).waitFor();

      await page.goto("/projects");
      await page.getByLabel("Search projects").fill("does-not-exist");
      await page
        .getByRole("heading", { name: "No matching records", exact: true })
        .waitFor();
      await page.getByLabel("Search projects").fill("Vision");
      await page
        .getByRole("link", { name: "Vision E2E", exact: true })
        .waitFor();
      await page.getByText("Saved views", { exact: true }).click();
      await page.getByLabel("New view name").fill("Vision only");
      await page
        .getByRole("button", { name: "Save current filters", exact: true })
        .click();
      await page
        .getByText("View saved on this device.", { exact: true })
        .waitFor();
      await page.goto(`/projects/${projectId}`);
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByText("2 runs", { exact: true }).waitFor();
      await dialog.getByText("1 datasets", { exact: true }).waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Permanently delete", exact: true })
          .isDisabled(),
        true,
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.deepEqual(clientErrors, []);
    } finally {
      await context.close();
    }
  },
);

test(
  "historical scoring requires explicit protocol confirmation",
  { timeout: 90000 },
  async () => {
    const { context, page, write } = await session();
    try {
      const project = await write("/projects", {
        name: "Historical protocol project",
      });
      const experiment = await write("/experiments", {
        project_id: project.id,
        name: "Historical protocol",
        metric_policy_confirmed: false,
      });
      const run = await write("/runs", {
        experiment_id: experiment.id,
        name: "Historical run",
        status: "completed",
      });
      await write(`/runs/${run.id}/metrics`, {
        name: "val_accuracy",
        value: 0.95,
        unit: "fraction",
        split: "validation",
      });
      await page.goto(`/experiments/${experiment.id}`);
      await page
        .getByText(/Historical readings need a protocol review/)
        .waitFor();
      await page
        .getByRole("button", {
          name: "Review evaluation protocol",
          exact: true,
        })
        .click();
      let dialog = page.getByRole("dialog");
      const confirmation = dialog.getByRole("checkbox", {
        name: /I reviewed this protocol/,
      });
      assert.equal(await confirmation.isChecked(), false);
      await dialog
        .getByLabel("Description", { exact: true })
        .fill("Metadata edit keeps scoring unconfirmed");
      await submitAndClose(dialog, "Save changes");
      const unchanged = await (
        await context.request.get(`/api/experiments/${experiment.id}`)
      ).json();
      assert.equal(unchanged.metric_policy_confirmed, false);
      await page
        .getByRole("button", {
          name: "Review evaluation protocol",
          exact: true,
        })
        .click();
      dialog = page.getByRole("dialog");
      await dialog
        .getByRole("checkbox", { name: /I reviewed this protocol/ })
        .check();
      await submitAndClose(dialog, "Save changes");
      const confirmed = await (
        await context.request.get(`/api/experiments/${experiment.id}`)
      ).json();
      assert.equal(confirmed.metric_policy_confirmed, true);
      const ranked = await (
        await context.request.get(
          `/api/leaderboard?experiment_id=${experiment.id}`,
        )
      ).json();
      assert.equal(ranked.length, 1);
      assert.equal(ranked[0].score, 0.95);
    } finally {
      await context.close();
    }
  },
);

test(
  "experiment result exports include runs beyond the first API page",
  { timeout: 90000 },
  async () => {
    const { context, page, write } = await session();
    try {
      await write("/workspace/import", {
        dry_run: false,
        data: {
          format: "model-lab",
          version: 1,
          projects: [
            { id: "source-project", name: "Export pagination project" },
          ],
          experiments: [
            {
              id: "source-experiment",
              project_id: "source-project",
              name: "Export pagination experiment",
            },
          ],
          runs: Array.from({ length: 501 }, (_, index) => ({
            id: `source-run-${index}`,
            experiment_id: "source-experiment",
            name: `Export run ${index}`,
            status: "completed",
          })),
        },
      });
      const experiments = await (
        await context.request.get("/api/experiments?q=Export%20pagination")
      ).json();
      assert.equal(experiments.length, 1);
      await page.goto(`/experiments/${experiments[0].id}`);
      const downloading = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export results CSV", exact: true })
        .click();
      const stream = await (await downloading).createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const report = Buffer.concat(chunks).toString("utf8");
      assert.equal(
        report.split("\r\n").length,
        502,
        "CSV includes the header and all 501 runs",
      );
      assert.match(report, /Export run 500/);
    } finally {
      await context.close();
    }
  },
);

test(
  "mobile resource workflow retains form during delayed lookup and exposes usable navigation",
  { timeout: 90000 },
  async () => {
    const { context, page, write } = await session({ width: 390, height: 844 });
    try {
      const project = await write("/projects", { name: "Mobile project" });
      await page.route("**/api/projects?limit=500", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 700));
        await route.continue();
      });
      await page.goto("/models");
      const dialog = await openCreate(page, "Register model");
      await dialog.getByLabel("Name", { exact: true }).fill("Draft retained");
      await dialog
        .getByLabel("Project", { exact: true })
        .selectOption(project.id);
      assert.equal(
        await dialog.getByLabel("Name", { exact: true }).inputValue(),
        "Draft retained",
      );
      await submitAndClose(dialog, "Create model");
      await page
        .getByRole("link", { name: "Draft retained", exact: true })
        .waitFor();
      const width = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      assert.ok(
        width.content <= width.viewport + 1,
        "mobile document has no horizontal overflow",
      );
    } finally {
      await context.close();
    }
  },
);
