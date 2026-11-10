import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
const load = async (path) => {
  const exports = {};
  runInNewContext(
    ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports },
  );
  return exports;
};
const { trendCaseRows, recordedCaseState } = await load(
  "../app/lib/unit-trend-explorer.ts",
);
const {
  historyProgression,
  trendReference,
  historyTrendValue,
  HISTORY_TREND_METRICS,
} = await load("../app/lib/unit-history-trend.ts");
const record = (name, verdict, extra = {}) => ({
  case_id: name,
  test_name: name,
  test_type: "single",
  verdict,
  scores: { accuracy: 5 },
  thresholds: { accuracy: 4 },
  ...extra,
});
const run = (id, branch, day, extra = {}) => ({
  runId: id,
  sourceBranch: branch,
  branchLabel: branch,
  stage: "dev",
  targetEnvironment: "east",
  environment: "staging",
  startedAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`,
  qualityMeasured: true,
  total: 2,
  passed: 1,
  passRatePct: 50,
  durationMs: 2000,
  ...extra,
});
test("shared final tests compare independently of other changed or new tests", () => {
  const rows = trendCaseRows(
    [
      record("recovered", "passed"),
      record("regressed", "failed"),
      record("new", "passed"),
      record("changed", "passed", { thresholds: { accuracy: 3 } }),
    ],
    [
      record("recovered", "failed"),
      record("regressed", "passed"),
      record("changed", "failed"),
    ],
    true,
  );
  const changes = Object.fromEntries(rows.map((r) => [r.label, r.change]));
  assert.deepEqual(changes, {
    regressed: "New failure",
    recovered: "Recovered",
    changed: "Definition changed",
    new: "New test",
  });
});
test("ambiguous and non-final case verdicts never become a recovery or regression", () => {
  const now = [
    record("duplicate", "passed"),
    record("duplicate", "failed"),
    record("blocked", "blocked"),
    record("pending", "pending"),
  ];
  const before = [
    record("duplicate", "failed"),
    record("blocked", "failed"),
    record("pending", "passed"),
  ];
  assert.ok(
    trendCaseRows(now, before, true).every((r) => r.change === "Not compared"),
  );
  assert.ok(
    trendCaseRows(
      [record("one", "passed")],
      [record("one", "failed")],
      false,
    ).every((r) => r.change === "Not compared"),
  );
  assert.equal(recordedCaseState(undefined), "Unavailable");
  assert.equal(recordedCaseState(record("x", "blocked")), "Blocked / error");
});
test("progression crosses version changes and reports only known recorded differences", () => {
  const a = run("a", "previous", 1, {
    bsaVersion: "1.17",
    skillVersion: "1",
    caseSetKey: "a",
  });
  const b = run("b", "new", 2, {
    bsaVersion: "1.18",
    skillVersion: "2",
    caseSetKey: "b",
    passRatePct: 75,
  });
  const c = run("c", "new", 3, {
    ...b,
    runId: "c",
    startedAt: "2026-10-03T10:00:00Z",
    passRatePct: 100,
  });
  const p = historyProgression([c, b, a]);
  assert.equal(p.get("b").previousBranch.run.runId, "a");
  assert.equal(p.get("c").previousBranch.run.runId, "a");
  assert.equal(p.get("c").previousSameBranch.run.runId, "b");
  assert.equal(p.get("c").previousBranch.passRateDelta, 50);
  assert.ok(
    p.get("b").previousBranch.changes.includes("BSA version 1.17 → 1.18"),
  );
  assert.equal(
    trendReference(run("x", "x", 1), run("y", "y", 1)).changes.length,
    0,
  );
  assert.ok(
    !p.get("b").previousBranch.changes.some((x) => x.includes("not recorded")),
  );
});
test("references remain inside context and an initially oldest branch can pick up a later other branch", () => {
  const a = run("a", "first", 1),
    b = run("b", "second", 2),
    a2 = run("a2", "first", 3),
    west = run("west", "second", 4, { targetEnvironment: "west" }),
    prod = run("prod", "second", 4, { stage: "prod" });
  const p = historyProgression([prod, west, a2, b, a]);
  assert.equal(p.get("a").previousBranch, null);
  assert.equal(p.get("a2").previousBranch.run.runId, "b");
  assert.equal(p.get("west").previousBranch, null);
  assert.equal(p.get("prod").previousBranch, null);
});
test("equal timestamps preserve API tie order and history input is not mutated", () => {
  const rows = [
    run("c", "third", 1),
    run("b", "second", 1),
    run("a", "first", 1),
  ];
  const p = historyProgression(rows);
  assert.equal(p.get("c").previousBranch.run.runId, "b");
  assert.deepEqual(
    rows.map((r) => r.runId),
    ["c", "b", "a"],
  );
});
test("four trend metrics retain zero values; test volume is neutral and fewer failures is better", () => {
  const r = run("a", "a", 1, { passed: 2, passRatePct: 100 });
  assert.equal(historyTrendValue(r, "cases"), 2);
  assert.equal(historyTrendValue(r, "failed"), 0);
  assert.equal(historyTrendValue(r, "duration"), 2);
  assert.equal(
    historyTrendValue({ ...r, qualityMeasured: false }, "failed"),
    null,
  );
  assert.equal(historyTrendValue({ ...r, passed: null }, "failed"), null);
  assert.equal(HISTORY_TREND_METRICS.cases.better, null);
  assert.equal(HISTORY_TREND_METRICS.failed.better, "lower");
});
