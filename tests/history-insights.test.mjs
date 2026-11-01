import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function moduleFrom(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require: (name) => imports[name] ?? {},
    AbortController,
  });
  return exports;
}
const analysis = await moduleFrom("../app/lib/history-insights.ts");
const time = await moduleFrom("../app/lib/time-window.ts");
const { loadWindowRuns } = await moduleFrom(
  "../app/components/history-insights.tsx",
  {
    "../lib/time-window": time,
  },
);
const run = (id, branch = "main", rate = 100, extra = {}) => ({
  runId: id,
  evalType: "unit",
  gitRef: `refs/heads/${branch}`,
  stage: "dev",
  target: "payroll",
  startedAt: `2026-10-${String(id).padStart(2, "0")}T10:00:00Z`,
  verdict: rate === 100 ? "passed" : "failed",
  executionStatus: "completed",
  summary: { total: 2, passRatePct: rate },
  unitConfig: { skillId: "payroll", category: "HR", targetEnvironment: "east" },
  ...extra,
});
const item = (verdict) => ({
  suite: "payroll",
  testName: "tax",
  caseId: "tax",
  verdict,
  score: 1,
});
const ids = (runs) => Array.from(runs, (r) => r.runId);

test("branch normalization and automatic baseline use only recorded refs", () => {
  assert.equal(analysis.normalizeBranch(" refs/heads/main "), "main");
  assert.equal(analysis.normalizeBranch("refs/pull/18/merge"), "PR #18");
  assert.equal(analysis.normalizeBranch(), analysis.UNRECORDED_BRANCH);
  assert.equal(
    analysis.pickBaselineBranch([run(1, "feature"), run(2, "main")]),
    "main",
  );
  assert.equal(analysis.pickBaselineBranch([]), null);
});

test("landscape compares latest matching environment on baseline", () => {
  const runs = [
    run(1, "main", 100),
    run(2, "main", 20, { stage: "prod" }),
    run(3, "feature", 90),
  ];
  const landscape = analysis.buildLandscape(runs, "main", "unit");
  const cell = landscape.cells.get(analysis.cellKey("payroll", "feature"));
  assert.equal(cell.deltaVsBaseline, -10);
  assert.equal(cell.regressed, true);
  assert.equal(landscape.branches[0].branch, "main");
  assert.ok(landscape.insights.some((i) => i.kind === "environment-gap"));
});

test("matrix distinguishes regressions, fixes and repeated same-context flips", () => {
  const runs = [
    run(1),
    run(2, "bad", 0),
    run(3, "flaky", 100),
    run(4, "flaky", 0),
    run(5, "flaky", 100),
  ];
  const cases = {
    1: [item("passed")],
    2: [item("failed")],
    3: [item("passed")],
    4: [item("failed")],
    5: [item("passed")],
  };
  const matrix = analysis.buildTestMatrix(runs, cases, "main");
  const key = analysis.caseTestKey(item("passed"));
  assert.equal(
    matrix.cells.get(analysis.cellKey(key, "bad")).state,
    "regression",
  );
  assert.equal(matrix.cells.get(analysis.cellKey(key, "flaky")).state, "flaky");
  const fixed = analysis.buildTestMatrix(
    [run(1, "main", 0), run(2, "fix")],
    { 1: [item("failed")], 2: [item("passed")] },
    "main",
  );
  assert.equal(fixed.cells.get(analysis.cellKey(key, "fix")).state, "fixed");
});

test("consistent environment split does not become flaky or a shared bottleneck", () => {
  const runs = [
    run(1, "main", 0),
    run(2, "main", 100, { stage: "prod" }),
    run(3, "main", 0),
    run(4, "main", 100, { stage: "prod" }),
  ];
  const matrix = analysis.buildTestMatrix(
    runs,
    {
      1: [item("failed")],
      2: [item("passed")],
      3: [item("failed")],
      4: [item("passed")],
    },
    "main",
  );
  assert.equal(matrix.tests[0].flaky, false);
  assert.equal(matrix.tests[0].bottleneck, false);
  assert.equal(matrix.tests[0].environmentSplit.failing[0], "dev · east");
  assert.ok(matrix.insights.some((i) => i.kind === "environment-gap"));
});

test("case budget uses newest runs and round robin across branches", () => {
  const runs = [
    run(1, "main"),
    run(2, "main"),
    run(3, "main"),
    run(4, "feature"),
    run(5, "feature"),
  ];
  assert.deepEqual(ids(analysis.runsForCaseLoad(runs, 2, 3)), [5, 3, 4]);
  assert.equal(analysis.runsForCaseLoad(runs, 2, 0).length, 0);
});

test("run loader fixes UTC bounds across pages and excludes the other type", async () => {
  const calls = [];
  const api = {
    listRunBatch: async (...args) => {
      calls.push(args);
      return {
        items: [run(calls.length)],
        nextCursors: calls.length === 1 ? { unit: "next" } : {},
      };
    },
  };
  const controller = new AbortController();
  const result = await loadWindowRuns(api, "unit", "7d", controller.signal);
  assert.equal(result.items.length, 2);
  assert.equal(result.truncated, false);
  assert.equal(calls[0][0].e2e, null);
  assert.equal(calls[1][0].unit, "next");
  assert.equal(calls[0][1], 200);
  assert.equal(calls[0][2], controller.signal);
  assert.equal(calls[0][3].startedFrom, calls[1][3].startedFrom);
  assert.equal(calls[0][3].startedBefore, calls[1][3].startedBefore);
});

test("loader surfaces API errors and identifies the five-page sample cap", async () => {
  let calls = 0;
  const result = await loadWindowRuns(
    {
      listRunBatch: async () => {
        calls += 1;
        return {
          items: Array.from({ length: 200 }, () => run(1)),
          nextCursors: { e2e: "more" },
        };
      },
    },
    "e2e",
    "30d",
    new AbortController().signal,
  );
  assert.equal(calls, 5);
  assert.equal(result.items.length, 1000);
  assert.equal(result.truncated, true);
  await assert.rejects(
    loadWindowRuns(
      {
        listRunBatch: async () => {
          throw new Error("offline");
        },
      },
      "unit",
      "7d",
      new AbortController().signal,
    ),
    /offline/,
  );
});
