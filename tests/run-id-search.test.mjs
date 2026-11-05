import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let lookupEffect;
let filterMemo;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("setRunIdLookup")) lookupEffect = node.arguments[0];
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "filteredRuns") filterMemo = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);

// Execute the component's actual effect and filter; no copied lookup logic.
function evaluate(node, context) {
  assert.ok(node);
  const { outputText } = ts.transpileModule(`(${node.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return runInNewContext(outputText, context);
}

function startLookup(search, getRun) {
  const states = [];
  let timer;
  const cleanup = evaluate(lookupEffect, {
    search, api: { getRun }, AbortController, Error,
    setRunIdLookup: (value) => states.push(value),
    setTimeout: (callback, delay) => { assert.equal(delay, 350); timer = callback; return 1; },
    clearTimeout: () => { timer = null; },
  })();
  return { states, cleanup, fire: () => timer?.() };
}

function run(overrides = {}) {
  return {
    runId: "unit-301c769ef6", evalType: "unit", startedAt: "2026-09-20T17:21:01.413Z",
    actor: "tester", stage: "1-dev-staging", target: "payroll", executionStatus: "completed",
    verdict: "passed", githubRepository: "org/skills", gitRef: "feature/payroll", gitSha: "abc123",
    unitConfig: { category: "domain-skills", skillId: "payroll", targetEnvironment: "staging", agentName: "suite" },
    summary: { passRatePct: 100, meanScoreRecorded: true, meanScore: 4.5 },
    ...overrides,
  };
}

function results(overrides = {}) {
  const context = {
    ...Object.fromEntries(["type", "verdict", "executionStatus", "category", "skillFilter",
      "targetEnvironment", "agentName", "trigger", "actor"].map((key) => [key, "all"])),
    runs: [], search: "unit-301c769ef6", selectedStages: [], runTimeWindow: null,
    issueFilterActive: false, issueResultsPending: false, issueCollection: { runs: [] },
    runListFilters: {}, runIdLookup: { query: "unit-301c769ef6", run: run() },
    minimumGateThreshold: "", minimumPassRate: "", minimumMeanScore: "", sortOrder: "newest",
    effectiveRunVerdict: (value) => value.verdict,
    ...overrides,
  };
  return Array.from(evaluate(filterMemo.arguments[0], context)());
}

test("unit and E2E IDs use the exact-run endpoint after the debounce", async () => {
  for (const type of ["unit", "e2e"]) {
    const calls = [];
    const record = run({ runId: `${type}-301c769ef6`, evalType: type });
    const lookup = startLookup(`  ${record.runId}  `, async (...args) => { calls.push(args); return record; });
    assert.equal(calls.length, 0);
    assert.equal(lookup.states.length, 0);
    await lookup.fire();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], type);
    assert.equal(calls[0][1], record.runId);
    assert.equal(lookup.states.at(-1).run, record);
    assert.equal(lookup.states.at(-1).loading, false);
    lookup.cleanup();
    assert.equal(calls[0][2].aborted, true);
  }
});

test("ordinary text and clearing search do not request exact runs", async () => {
  for (const search of ["", "payroll", "abc123", "unit-", "actor name"]) {
    const lookup = startLookup(search, () => assert.fail("unexpected request"));
    await lookup.fire();
    assert.equal(lookup.states.length, 0);
  }
});

test("cleanup cancels queued requests and ignores late successes and failures", async () => {
  const queued = startLookup("unit-301c769ef6", () => assert.fail("cancelled timer fired"));
  queued.cleanup();
  await queued.fire();
  for (const rejected of [false, true]) {
    let finish;
    const lookup = startLookup("unit-301c769ef6", () => new Promise((resolve, reject) => {
      finish = () => rejected ? reject(new Error("late error")) : resolve(run());
    }));
    const pending = lookup.fire();
    lookup.cleanup();
    finish();
    await pending;
    assert.equal(lookup.states.length, 1);
  }
});

test("missing runs and API failures are reported and stop loading", async () => {
  for (const message of ["Eval API 404: missing", "Eval API 503: unavailable"]) {
    const lookup = startLookup("unit-301c769ef6", async () => { throw new Error(message); });
    await lookup.fire();
    const state = lookup.states.at(-1);
    assert.equal(state.loading, false);
    assert.equal(state.run, null);
    assert.equal(state.error, message.includes("404") ? "No run found with ID unit-301c769ef6." : message);
  }
});

test("an older run outside the loaded pages is searchable without mutating those pages", () => {
  const loaded = Array.from({ length: 200 }, (_, index) => run({ runId: `unit-new-${index}` }));
  assert.equal(results({ runs: loaded })[0].runId, "unit-301c769ef6");
  assert.equal(loaded.length, 200);
  assert.equal(results({ runs: [run()] }).length, 1);
  assert.equal(results({ search: "  UNIT-301C769EF6  " }).length, 1);
});

test("lookup results remain scoped to the current search and do not leak when cleared", () => {
  assert.equal(results({ search: "unit-other" }).length, 0);
  assert.equal(results({ search: "" }).length, 0);
  assert.equal(results({ runIdLookup: { query: "unit-old", run: run() } }).length, 0);
});

test("direct lookup respects source, metadata, quality and time filters", () => {
  const exclusions = [
    { runListFilters: { githubRepository: "other/repo" } },
    { runListFilters: { gitRef: "other-branch" } },
    { runListFilters: { gitSha: "other-sha" } },
    { type: "e2e" }, { verdict: "failed" }, { executionStatus: "running" },
    { category: "other" }, { skillFilter: "other" }, { selectedStages: ["other"] },
    { targetEnvironment: "other" }, { agentName: "other" }, { actor: "other" },
    { minimumMeanScore: "5" },
    { runTimeWindow: { startedFrom: "2026-10-01T00:00:00Z", startedBefore: "2026-11-01T00:00:00Z" } },
  ];
  for (const filters of exclusions) assert.equal(results(filters).length, 0, JSON.stringify(filters));
  assert.equal(results({ runListFilters: { githubRepository: "org/skills", gitRef: "feature/payroll", gitSha: "abc123" } }).length, 1);
  const dependencies = filterMemo.arguments[1].elements.map((node) => node.getText(ast));
  assert.ok(dependencies.includes("runIdLookup"));
  assert.ok(dependencies.includes("runListFilters"));
});
