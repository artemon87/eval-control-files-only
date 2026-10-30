import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
let nextLabel;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    declarations.set(node.name.text, node.initializer);
  }
  if (ts.isJsxExpression(node) && node.expression) {
    const text = node.expression.getText(ast);
    if (text.includes("loadingOlder") && text.includes('"Next"')) nextLabel = node.expression;
  }
  ts.forEachChild(node, visit);
}
visit(ast);

// Execute the actual component expressions, so regressions do not pass against copied logic.
function evaluate(node, context) {
  assert.ok(node);
  const { outputText } = ts.transpileModule(`(${node.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return runInNewContext(outputText, context);
}

test("run list excludes injected out-of-window runs using half-open bounds", () => {
  const runs = [
    ["old", "2026-10-29T11:59:59.999Z"],
    ["start", "2026-10-29T12:00:00.000Z"],
    ["inside", "2026-10-30T11:59:59.999Z"],
    ["end", "2026-10-30T12:00:00.000Z"],
    ["future", "2026-10-31T12:00:00.000Z"],
    ["invalid", "not-a-date"],
  ].map(([runId, startedAt]) => ({ runId, startedAt, summary: {} }));
  const context = {
    ...Object.fromEntries([
      "type", "verdict", "executionStatus", "category", "skillFilter",
      "targetEnvironment", "agentName", "trigger", "actor",
    ].map((name) => [name, "all"])),
    runs,
    search: "",
    selectedStages: [],
    minimumGateThreshold: "",
    minimumPassRate: "",
    minimumMeanScore: "",
    sortOrder: "oldest",
    runTimeWindow: {
      startedFrom: "2026-10-29T12:00:00.000Z",
      startedBefore: "2026-10-30T12:00:00.000Z",
    },
  };
  const memo = declarations.get("filteredRuns");
  const filter = memo.arguments[0];
  assert.deepEqual(Array.from(evaluate(filter, context)(), (run) => run.runId), ["start", "inside"]);
  assert.equal(evaluate(filter, { ...context, runTimeWindow: null })().length, runs.length);
  assert.ok(memo.arguments[1].elements.some((node) => node.getText(ast) === "runTimeWindow"));
});

test("trend pagination fills partial pages before advancing and handles exhausted cursors", async () => {
  for (const scenario of [
    { count: 30, size: 20, page: 2, expected: 2, fetches: 1 },
    { count: 60, size: 20, page: 2, expected: 3, fetches: 0 },
    { count: 40, size: 20, page: 2, expected: 3, fetches: 1 },
    { count: 30, size: 5, page: 6, expected: 7, fetches: 1 },
    { count: 30, size: 10, page: 3, expected: 4, fetches: 1 },
    { count: 30, size: 20, page: 2, expected: 2, fetches: 0, cursor: null },
    { count: 40, size: 20, page: 2, expected: 2, fetches: 1, loaded: 0 },
  ]) {
    let page = scenario.page;
    let fetches = 0;
    const context = {
      newestPoints: Array(scenario.count),
      historyPageSize: scenario.size,
      currentHistoryPage: page,
      historyPageCount: Math.ceil(scenario.count / scenario.size),
      nextCursor: scenario.cursor === null ? null : "older",
      setHistoryPage: (value) => { page = value; },
      loadOlder: async () => { fetches++; return scenario.loaded ?? 30; },
    };
    context.lastPageIsPartial = evaluate(declarations.get("lastPageIsPartial"), context);
    await evaluate(declarations.get("showNextHistoryPage"), context)();
    assert.equal(page, scenario.expected, JSON.stringify(scenario));
    assert.equal(fetches, scenario.fetches, JSON.stringify(scenario));
  }
});

test("partial last pages with older records say Load more; other pages say Next", () => {
  const context = {
    loadingOlder: false, nextCursor: "older", currentHistoryPage: 2,
    historyPageCount: 2, lastPageIsPartial: true,
  };
  assert.equal(evaluate(nextLabel, context), "Load more");
  assert.equal(evaluate(nextLabel, { ...context, loadingOlder: true }), "Loading…");
  assert.equal(evaluate(nextLabel, { ...context, nextCursor: null }), "Next");
  assert.equal(evaluate(nextLabel, { ...context, lastPageIsPartial: false }), "Next");
  assert.equal(evaluate(nextLabel, { ...context, currentHistoryPage: 1 }), "Next");
});
