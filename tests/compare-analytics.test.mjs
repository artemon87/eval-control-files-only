import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function loadModule(path, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  runInNewContext(outputText, { exports, URLSearchParams, AbortController, setTimeout, clearTimeout, ...globals });
  return exports;
}
const { EvalApi } = await loadModule("../app/lib/eval-api.ts");
const scopes = await loadModule("../app/lib/comparison-scope.ts");
const { fixedTimeWindow } = await loadModule("../app/lib/time-window.ts");

const run = (id, overrides = {}) => ({
  runId: id, evalType: "unit", executionStatus: "completed", githubRepository: "org/a",
  startedAt: "2026-10-30T12:00:00Z", environment: "runner-a", stage: "staging",
  unitConfig: { skillId: "payroll", category: "domain", stage: "staging", targetEnvironment: "east" },
  ...overrides,
});

test("unit comparison isolates skill/repository/stage and each target/environment", () => {
  const runs = [run("baseline"), run("candidate", { unitConfig: { skillId: "payroll", category: "domain", stage: "staging", targetEnvironment: "west" } }),
    run("prod", { stage: "prod", unitConfig: { skillId: "payroll", stage: "prod", targetEnvironment: "east" } }),
    run("repo-b", { githubRepository: "org/b" }), run("runner-b", { environment: "runner-b" }),
    run("queued", { executionStatus: "queued" }), run("other", { unitConfig: { skillId: "other" } }),
    run("legacy", { unitConfig: { skillId: "payroll" } }),
  ];
  const select = (target) => Array.from(scopes.selectUnitRuns(runs, "payroll", "org/a", "staging", scopes.unitTargetKey(target)), (r) => r.runId);
  assert.deepEqual(select(runs[0]), ["baseline"]);
  assert.deepEqual(select(runs[1]), ["candidate"]);
  assert.deepEqual(select(runs.at(-1)), ["legacy"]);
  assert.match(scopes.unitScopeLabel(runs.at(-1)), /Target not recorded/);
  assert.match(scopes.unitScopeLabel(runs[1]), /staging.*west.*runner-a.*domain/);
  assert.equal(scopes.selectUnitRuns(runs, "payroll", "org/a", undefined, undefined, "missing").length, 0);
});

test("7/30/90 day windows are anchored to now with exact half-open boundaries", async () => {
  for (const days of [7, 30, 90]) {
    const now = new Date("2026-10-30T15:45:00Z");
    const bounds = fixedTimeWindow(`${days}d`, now);
    assert.equal(Date.parse(bounds.startedBefore) - Date.parse(bounds.startedFrom), days * 86_400_000);
    const api = new EvalApi("/api");
    const requests = [];
    api.listRunBatch = async (cursors, limit, signal, filters) => {
      requests.push({ cursors, limit, filters });
      return requests.length === 1
        ? { items: [run("start", { startedAt: bounds.startedFrom }), run("end", { startedAt: bounds.startedBefore })], nextCursors: { unit: "older", e2e: null } }
        : { items: [run("older-inside", { startedAt: new Date(Date.parse(bounds.startedFrom) + 1).toISOString() }), run("too-old", { startedAt: "2025-01-01T00:00:00Z" })], nextCursors: { unit: null, e2e: null } };
    };
    const result = await api.listRunCollection(bounds);
    assert.deepEqual(Array.from(result, (r) => r.runId), ["older-inside", "start"]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.filters === bounds && request.limit === 200));
    assert.equal(requests[1].cursors.e2e, null);
  }
});

test("collections exhaust both streams, deduplicate, and never silently truncate", async () => {
  const api = new EvalApi("/api");
  let calls = 0;
  api.listRunBatch = async () => {
    calls++;
    return { items: [run("duplicate"), ...Array.from({ length: 200 }, (_, i) => run(`${calls}:${i}`))], nextCursors: { unit: calls < 3 ? String(calls) : null, e2e: null } };
  };
  assert.equal((await api.listRunCollection({}, undefined, "unit")).length, 601);
  assert.equal(calls, 3);
  api.listRunBatch = async () => ({ items: [], nextCursors: { unit: "stuck", e2e: null } });
  await assert.rejects(api.listRunCollection({}), /did not advance/);
});

test("an abort or failed later page never publishes a partial collection", async () => {
  const api = new EvalApi("/api");
  const controller = new AbortController();
  let calls = 0;
  api.listRunBatch = async () => {
    calls++; controller.abort();
    return { items: [run("old")], nextCursors: { unit: "older", e2e: null } };
  };
  await assert.rejects(api.listRunCollection({}, controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
  api.listRunBatch = async (cursor) => {
    if (cursor.unit) throw new Error("second page failed");
    return { items: [run("first")], nextCursors: { unit: "older", e2e: null } };
  };
  await assert.rejects(api.listRunCollection({}), /second page failed/);
});

test("case comparison loads past 200 cases for both unit and E2E runs", async () => {
  for (const evalType of ["unit", "e2e"]) {
    const api = new EvalApi("/api");
    const paths = [];
    api.request = async (path) => {
      paths.push(path);
      return { items: Array.from({ length: paths.length === 1 ? 200 : 1 }, (_, i) => ({ case_id: `${paths.length}:${i}`, run_id: "one", skill: "payroll", scores: {}, thresholds: {} })), next_cursor: paths.length === 1 ? "older" : null };
    };
    assert.equal((await api.listCases(run("one", { evalType }))).length, 201);
    assert.match(paths[1], /cursor=older/);
  }
});

test("collection hook rejects late responses after a window change", async () => {
  let effect, state;
  const react = { useState: (initial) => [initial, (next) => { state = next; }], useEffect: (fn) => { effect = fn; } };
  const { useRunCollection } = await loadModule("../app/lib/use-run-collection.ts", { require: () => react });
  let resolve;
  const api = { listRunCollection: () => new Promise((done) => { resolve = done; }) };
  useRunCollection(api, { startedFrom: "old-window" });
  const cleanup = effect();
  cleanup();
  resolve([run("stale")]);
  await Promise.resolve();
  assert.equal(state, undefined);
});

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const history = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "HistoryView");
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node.initializer);
  ts.forEachChild(node, visit);
}
visit(history);
function evaluate(name, context) {
  const node = declarations.get(name);
  assert.ok(node, name);
  return runInNewContext(ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

test("history pages retain every row and reset when scope, window or size changes", () => {
  const trend = Array.from({ length: 63 }, (_, id) => ({ id }));
  const context = { trend, pageSize: 25, paginationKey: "current", pagination: { key: "current", page: 1 } };
  context.pageCount = evaluate("pageCount", context);
  const seen = [];
  for (let page = 1; page <= 3; page++) {
    context.pagination.page = page;
    context.currentPage = evaluate("currentPage", context);
    context.pageStart = evaluate("pageStart", context);
    seen.push(...Array.from(evaluate("visibleHistory", context), (p) => p.id));
  }
  assert.deepEqual(seen, [...trend].reverse().map((p) => p.id));
  assert.equal(evaluate("currentPage", { ...context, paginationKey: "changed" }), 1);
  assert.equal(evaluate("currentPage", { ...context, pagination: { key: "current", page: 100 } }), 3);
  assert.equal(evaluate("pageCount", { trend: [], pageSize: 25 }), 1);
  const fields = declarations.get("paginationKey").getText(ast);
  for (const field of ["historyType", "stage", "target", "category", "skillId", "resolvedUnitStage", "environment", "targetEnvironments", "timeWindow", "pageSize"]) assert.ok(fields.includes(field), field);
});

test("overview aggregates its independent complete window including the first partial UTC day", () => {
  const home = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "Home");
  let memo;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "overview") memo = node.initializer;
    ts.forEachChild(node, find);
  }
  find(home);
  const calculate = ts.transpileModule(`(${memo.arguments[0].getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const bounds = fixedTimeWindow("7d", new Date("2026-10-30T15:45:00Z"));
  const summary = { total: 1, passed: 1, passRatePct: 100 };
  const context = {
    overviewTimeWindow: bounds, overviewType: "all", runs: [],
    overviewCollection: { runs: [
      run("start", { startedAt: bounds.startedFrom, summary, verdict: "passed" }),
      run("inside", { startedAt: "2026-10-30T12:00:00Z", summary, verdict: "passed" }),
      run("end", { startedAt: bounds.startedBefore, summary, verdict: "passed" }),
    ] },
    dateKey: (at) => new Date(at).toISOString().slice(0, 10),
    isBlockedRun: () => false, isNeedsAttentionRun: () => false, percentile: () => 0,
  };
  const result = runInNewContext(calculate, context)();
  assert.deepEqual(Array.from(result.inView, (r) => r.runId), ["inside", "start"]);
  assert.equal(result.completed.length, 2);
  assert.equal(result.daily.length, 8);
  assert.equal(result.daily[0].date, "2026-10-23");
  assert.equal(result.daily[0].unit, 100);
  assert.equal(result.daily.at(-1).unit, 100);
});
