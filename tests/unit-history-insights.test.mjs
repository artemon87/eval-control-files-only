import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function moduleFrom(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  runInNewContext(outputText, { exports, URLSearchParams, AbortController, setTimeout, clearTimeout });
  return exports;
}
const utils = await moduleFrom("../app/lib/unit-history-utils.ts");
const { EvalApi } = await moduleFrom("../app/lib/eval-api.ts");
const cell = (latestState, extra = {}) => ({
  branchKey: "branch", executions: 5, passed: 2, failed: 2, blocked: 1, xpassed: 0,
  skipped: 0, pending: 0, latestState, latestRunId: "unit-latest", latestContextMatch: true,
  latestAt: "2026-10-30T00:00:00Z", ...extra,
});
const pattern = (key, cells, extra = {}) => ({
  key, label: key, executions: 10, failed: 4, affectedBranches: 2,
  cells, ...extra,
});
const ids = (values) => Array.from(values, (value) => value.key);

test("case filters follow the selected view rather than retaining historical failures", () => {
  const cases = [
    pattern("recovered", [cell("passed"), cell("passed")]),
    pattern("current", [cell("failed"), cell("failed", { latestContextMatch: false })], { affectedBranches: 1 }),
    pattern("missing", [cell("not_run"), cell("unavailable")], { failed: 0, affectedBranches: 0 }),
    pattern("infra", [cell("blocked")], { failed: 0, affectedBranches: 0 }),
  ];
  assert.deepEqual(ids(utils.selectHistoryCases(cases, "latest", "failed")), ["current"]);
  assert.deepEqual(ids(utils.selectHistoryCases(cases, "latest", "recurring")), ["current"]);
  assert.deepEqual(ids(utils.selectHistoryCases(cases, "period", "recurring")), ["recovered"]);
  assert.deepEqual(ids(utils.selectHistoryCases(cases, "period", "failed")), ["recovered", "current"]);
  assert.equal(utils.selectHistoryCases(cases, "latest", "all").length, 4);
  assert.equal(utils.selectHistoryCases([], "latest", "all").length, 0);
});

test("frequency uses executions with case evidence; errors and missing data remain explicit", () => {
  assert.equal(utils.caseCellLabel(cell("failed"), "period"), "2 / 5");
  assert.equal(utils.caseCellLabel(cell("passed", { executions: 0, failed: 0 }), "period"), "No matching runs");
  assert.equal(utils.caseCellLabel(cell("not_run"), "latest"), "Not run");
  assert.equal(utils.caseCellLabel(cell("unavailable"), "latest"), "Unavailable");
  assert.equal(utils.caseCellLabel(cell("blocked"), "latest"), "Blocked / error");
  assert.match(utils.caseCellContext(cell("passed"), "period"), /1 blocked\/error/);
  assert.match(utils.caseCellContext(cell("passed", { latestContextMatch: false }), "latest"), /Different or incomplete/);
});

test("same skill names in different repositories stay distinct, including missing repositories", () => {
  const a = { skill: "payroll", githubRepository: "org/a" };
  const b = { ...a, githubRepository: "org/b" };
  const missing = { ...a, githubRepository: null };
  assert.notEqual(utils.skillScopeKey(a), utils.skillScopeKey(b));
  assert.notEqual(utils.skillScopeKey(a), utils.skillScopeKey(missing));
  assert.equal(utils.rateLabel(null), "—");
  assert.equal(utils.rateLabel(0), "0%");
  assert.equal(utils.rateLabel(600 / 7), "85.7%");
});

test("History API sends opaque exact scope, fixed UTC bounds, configuration and cancellation", async () => {
  const api = new EvalApi("/api");
  const calls = [];
  const signal = new AbortController().signal;
  api.request = async (path, requestSignal) => { calls.push({ path, signal: requestSignal }); return { ok: true }; };
  await api.listUnitHistoryScopes(signal);
  await api.getUnitHistoryInsights({ scopeKey: "exact/repo+stage=target", startedFrom: "2026-10-01T00:00:00Z", startedBefore: "2026-10-31T00:00:00Z", cohortKey: "matching-config" }, signal);
  assert.equal(calls[0].path, "/unit/history/scopes");
  const url = new URL(calls[1].path, "https://example.test");
  assert.equal(url.pathname, "/unit/history/insights");
  assert.equal(url.searchParams.get("scope_key"), "exact/repo+stage=target");
  assert.equal(url.searchParams.get("started_from"), "2026-10-01T00:00:00Z");
  assert.equal(url.searchParams.get("started_before"), "2026-10-31T00:00:00Z");
  assert.equal(url.searchParams.get("cohort_key"), "matching-config");
  assert.ok(calls.every((call) => call.signal === signal));
  await api.getUnitHistoryInsights({ scopeKey: "exact", startedFrom: "a", startedBefore: "b" });
  assert.equal(new URL(calls[2].path, "https://example.test").searchParams.has("cohort_key"), false);
});

test("failed History requests surface errors without substituting incomplete analytics", async () => {
  const api = new EvalApi("/api");
  api.request = async () => { throw new Error("History 500"); };
  await assert.rejects(api.getUnitHistoryInsights({ scopeKey: "x", startedFrom: "a", startedBefore: "b" }), /History 500/);
  await assert.rejects(api.listUnitHistoryScopes(), /History 500/);
});
