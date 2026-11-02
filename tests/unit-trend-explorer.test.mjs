import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../app/lib/unit-trend-explorer.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
});
const exports = {};
runInNewContext(outputText, { exports });
const {
  comparableTrendRuns,
  previousTrendRun,
  completeTrendCaseComparison,
  trendCaseRows,
  recordedCaseState,
  trendCaseKey,
} = exports;
const cohorts = [{ key: "config", configurationComplete: true }];
const run = (id, extra = {}) => ({
  runId: id,
  branchKey: "feature",
  branchLabel: "feature/work",
  qualityMeasured: true,
  caseSetKey: "same",
  cohortKey: "config",
  total: 2,
  passed: 1,
  ...extra,
});
const record = (runId, name, verdict, extra = {}) => ({
  run_id: runId,
  case_id: name,
  test_name: name,
  test_type: "single",
  verdict,
  scores: { accuracy: verdict === "passed" ? 5 : 0 },
  thresholds: { accuracy: 4 },
  ...extra,
});

test("automatic reference stays within branch, respects repository tie order, and skips incomplete settings", () => {
  const current = run("current"),
    other = run("other", { branchKey: "other" }),
    blocked = run("blocked", { qualityMeasured: false }),
    different = run("different", { caseSetKey: "different" }),
    previous = run("previous");
  assert.equal(
    previousTrendRun(
      current,
      [current, other, blocked, different, previous],
      cohorts,
    ),
    previous,
  );
  assert.equal(previousTrendRun(current, [current, other], cohorts), undefined);
  assert.equal(
    previousTrendRun(
      { ...current, branchLabel: "Branch not recorded" },
      [current, previous],
      cohorts,
    ),
    undefined,
  );
  assert.equal(
    previousTrendRun(
      current,
      [current, previous],
      [{ key: "config", configurationComplete: false }],
    ),
    undefined,
  );
  assert.equal(comparableTrendRuns(current, other, cohorts), true); // explicit cross-branch selection is allowed
  assert.equal(comparableTrendRuns(current, current, cohorts), false);
  assert.equal(
    comparableTrendRuns(
      current,
      run("legacy", { caseSetKey: undefined }),
      cohorts,
    ),
    false,
  );
});

test("case deltas require complete unique final verdicts, matching definitions, and summary agreement", () => {
  const now = [record("new", "a", "failed"), record("new", "b", "passed")],
    before = [record("old", "a", "passed"), record("old", "b", "failed")];
  assert.equal(
    completeTrendCaseComparison(now, before, run("new"), run("old")),
    true,
  );
  assert.equal(
    completeTrendCaseComparison(
      now.slice(0, 1),
      before,
      run("new"),
      run("old"),
    ),
    false,
  );
  assert.equal(
    completeTrendCaseComparison(
      [now[0], now[0]],
      before,
      run("new"),
      run("old"),
    ),
    false,
  );
  assert.equal(
    completeTrendCaseComparison(
      now,
      before,
      run("new", { passed: 2 }),
      run("old"),
    ),
    false,
  );
  assert.equal(
    completeTrendCaseComparison(
      [{ ...now[0], run_id: "wrong" }, now[1]],
      before,
      run("new"),
      run("old"),
    ),
    false,
  );
  for (const verdict of ["blocked", "error", "pending", "skipped", "xpassed"]) {
    assert.equal(
      completeTrendCaseComparison(
        [{ ...now[0], verdict }, now[1]],
        before,
        run("new"),
        run("old"),
      ),
      false,
    );
  }
  assert.equal(
    completeTrendCaseComparison(
      [{ ...now[0], thresholds: { accuracy: 3 } }, now[1]],
      before,
      run("new"),
      run("old"),
    ),
    false,
  );
  assert.equal(
    completeTrendCaseComparison(
      [{ ...now[0], scores: { different: 0 } }, now[1]],
      before,
      run("new"),
      run("old"),
    ),
    false,
  );
  assert.equal(
    completeTrendCaseComparison(
      [{ ...now[0], test_type: "different" }, now[1]],
      before,
      run("new"),
      run("old"),
    ),
    false,
  );
  assert.equal(
    completeTrendCaseComparison(
      [{ ...now[0], test_name: "replacement" }, now[1]],
      before,
      run("new"),
      run("old"),
    ),
    false,
  );
});

test("changes show observed recovered/new failures; blocked, missing, or duplicate evidence never creates a pass", () => {
  const now = [record("new", "a", "failed"), record("new", "b", "passed")],
    before = [record("old", "a", "passed"), record("old", "b", "failed")];
  const rows = trendCaseRows(now, before, true);
  assert.deepEqual(
    Array.from(rows, (row) => [row.label, row.change]),
    [
      ["a", "New failure"],
      ["b", "Recovered"],
    ],
  );
  assert.ok(
    trendCaseRows(now, [], false).every((row) => row.change === "Not compared"),
  );
  const duplicated = trendCaseRows([now[0], now[0]], before, true);
  assert.equal(duplicated[0].current.length, 2);
  assert.equal(duplicated[0].change, "Not compared");
  assert.notEqual(
    trendCaseKey(now[0]),
    trendCaseKey({ ...now[0], test_type: "multi" }),
  );
  assert.equal(recordedCaseState(undefined), "Unavailable");
  assert.equal(
    recordedCaseState({ ...now[0], verdict: "error" }),
    "Blocked / error",
  );
});
