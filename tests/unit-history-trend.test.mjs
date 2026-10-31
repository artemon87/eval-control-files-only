import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/lib/unit-history-trend.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const exports = {};
runInNewContext(outputText, { exports });
const { historyTrendSeries, historyTrendValue, historyTrendCeiling } = exports;
const window = { startedFrom: "2026-10-01T00:00:00Z", startedBefore: "2026-10-31T00:00:00Z" };
const branches = [{ key: "main", label: "main" }, { key: "feature", label: "feature" }];
function run(id, day, extra = {}) { return { runId: id, branchKey: "main", branchLabel: "main", qualityMeasured: true, executionStatus: "completed", cohortKey: "config", caseSetKey: "set-a", startedAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`, passRatePct: 80, durationMs: 1200, ...extra }; }
function series(runs, metric = "passRate", config = "config") { return historyTrendSeries([...runs].reverse(), branches, window, metric, config); }

test("skill trends preserve fixed half-open bounds, completed runs, and separate branch series", () => {
  const result = series([run("at-start", 1), run("feature", 10, { branchKey: "feature" }), run("queued", 11, { executionStatus: "queued" }), run("old", 12, { startedAt: "2026-09-30T23:59:59Z" }), run("at-end", 31), run("other-config", 13, { cohortKey: "different" }), run("inside", 30)]);
  assert.deepEqual(Array.from(result, (branch) => [branch.branchKey, Array.from(branch.points, (p) => p.run.runId)]), [["main", ["at-start", "inside"]], ["feature", ["feature"]]]);
});

test("trend lines break on test-set changes, absent identities, and missing metric values", () => {
  const runs = [run("one", 1), run("two", 2), run("replacement-same-count", 3, { caseSetKey: "set-b" }), run("legacy", 4, { caseSetKey: undefined }), run("missing", 5, { passRatePct: null }), run("six", 6, { caseSetKey: "set-b" }), run("seven", 7, { caseSetKey: "set-b" })];
  const result = series(runs)[0];
  assert.deepEqual(Array.from(result.segments, (segment) => Array.from(segment, (p) => p.run.runId)), [["one", "two"], ["replacement-same-count"], ["legacy"], ["six", "seven"]]);
  assert.equal(result.points.length, 6);
});

test("zero metrics stay real, invalid values stay absent, and duration converts to seconds", () => {
  assert.equal(historyTrendValue(run("zero", 1, { passRatePct: 0 }), "passRate"), 0);
  assert.equal(historyTrendValue(run("zero-duration", 1, { durationMs: 0 }), "duration"), 0);
  assert.equal(historyTrendValue(run("duration", 1), "duration"), 1.2);
  for (const value of [null, undefined, Number.NaN, Infinity, -1, 101]) assert.equal(historyTrendValue(run("invalid", 1, { passRatePct: value }), "passRate"), null);
  assert.equal(series([run("missing", 1, { durationMs: null })], "duration").length, 0);
});

test("known measurements without a case-set fingerprint remain isolated", () => {
  const result = series([run("one", 1, { cohortKey: null, caseSetKey: null }), run("two", 2, { cohortKey: null, caseSetKey: null })], "passRate", null);
  assert.equal(result[0].points.length, 2);
  assert.ok(result[0].segments.every((segment) => segment.length === 1));
  assert.equal(historyTrendSeries([], branches, window, "passRate", null).length, 0);
});

test("chart domains and duplicate timestamps preserve actual values and API tie order", () => {
  const result = series([run("earlier-id-z", 1), run("later-id-a", 1), run("long", 2, { durationMs: 61000 })], "duration");
  assert.deepEqual(Array.from(result[0].points, (p) => p.run.runId), ["earlier-id-z", "later-id-a", "long"]);
  assert.equal(historyTrendCeiling(result, "duration"), 100);
  assert.equal(historyTrendCeiling(result, "passRate"), 100);
  assert.equal(historyTrendCeiling([], "duration"), 1);
});

test("blocked or unmeasured summaries never plot as zero quality or duration", () => {
  const { isOperationalHistoryRun } = exports;
  const blocked = run("blocked", 3, {
    qualityMeasured: false,
    blockedCases: 1,
    passRatePct: 0,
  });
  assert.equal(isOperationalHistoryRun(blocked), true);
  assert.equal(historyTrendValue(blocked, "passRate"), null);
  assert.equal(historyTrendValue(blocked, "duration"), null);
  assert.equal(
    historyTrendValue(
      run("legacy", 4, { qualityMeasured: undefined }),
      "passRate",
    ),
    null,
  );
  const result = series([
    run("one", 1),
    run("two", 2),
    blocked,
    run("four", 4),
  ])[0];
  assert.deepEqual(
    Array.from(result.segments, (s) => Array.from(s, (p) => p.run.runId)),
    [["one", "two"], ["four"]],
  );
  const unknownBranch = series([
    run("one", 1, { branchLabel: "Branch not recorded" }),
    run("two", 2, { branchLabel: "Branch not recorded" }),
  ])[0];
  assert.ok(unknownBranch.segments.every((s) => s.length === 1));
});
