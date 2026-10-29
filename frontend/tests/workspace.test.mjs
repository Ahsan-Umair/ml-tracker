import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMetric,
  metricMatches,
  sameEvaluation,
  jsonObject,
  csvCell,
} from "../src/lib/workspace.ts";

test("metric formatting uses the declared unit instead of guessing from value", () => {
  assert.equal(formatMetric(0.9, "fraction"), "90%");
  assert.equal(formatMetric(0.9, "percent"), "0.9%");
  assert.equal(formatMetric(0.9, "number"), "0.9");
  assert.equal(formatMetric(-2.5, "ms"), "-2.5 ms");
  assert.equal(formatMetric(null, "fraction"), "—");
});

test("evaluation comparisons require matching experiment and complete protocol", () => {
  const baseline = {
    experiment_id: "exp_a",
    primary_metric: "loss",
    metric_split: "test",
    metric_unit: "number",
    metric_direction: "min",
    metric_aggregation: "final",
  };
  assert.equal(sameEvaluation(baseline, { ...baseline }), true);
  for (const changed of [
    { experiment_id: "exp_b" },
    { primary_metric: "accuracy" },
    { metric_split: "training" },
    { metric_unit: "fraction" },
    { metric_direction: "max" },
    { metric_aggregation: "best" },
    { metric_policy_confirmed: false },
  ])
    assert.equal(sameEvaluation(baseline, { ...baseline, ...changed }), false);
  assert.equal(
    metricMatches(
      {
        id: "a",
        name: "loss",
        split: "test",
        unit: "number",
        value: 0.2,
        step: 1,
      },
      baseline,
    ),
    true,
  );
  assert.equal(
    metricMatches(
      {
        id: "b",
        name: "loss",
        split: "training",
        unit: "number",
        value: 0.1,
        step: 1,
      },
      baseline,
    ),
    false,
  );
  assert.equal(sameEvaluation({}, {}), false);
});

test("guided parameter JSON accepts objects and rejects arrays and null", () => {
  assert.deepEqual(jsonObject('{"seed":42,"enabled":true}', "Parameters"), {
    seed: 42,
    enabled: true,
  });
  assert.throws(() => jsonObject("[]", "Parameters"), /must be a JSON object/);
  assert.throws(
    () => jsonObject("null", "Parameters"),
    /must be a JSON object/,
  );
});

test("CSV exports escape quotes and spreadsheet formulas", () => {
  assert.equal(csvCell('one,"two"'), '"one,""two"""');
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.equal(csvCell(0.92), '"0.92"');
  assert.equal(csvCell(-0.92), '"-0.92"');
});
