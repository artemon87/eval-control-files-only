import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
let nextLabel;
let runNextLabel;
let runNextButton;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    declarations.set(node.name.text, node.initializer);
  }
  if (ts.isJsxExpression(node) && node.expression) {
    const text = node.expression.getText(ast);
    if (text.includes("loadingOlder") && text.includes('"Next"')) nextLabel = node.expression;
    if (text.includes("loadingMoreRuns") && text.includes('"Load more"')) runNextLabel = node.expression;
  }
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "button" &&
      node.attributes.getText(ast).includes("showNextRunPage")) {
    runNextButton = node;
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
    issueFilterActive: false, issueResultsPending: false, issueCollection: { runs: [] },
    runIdLookup: { query: "", run: null },
    runListFilters: {},
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

// Recompute the real component expressions after each mocked server batch.
function runPagination({ count, page, batches = [], hasOlderRuns = true, loadingMoreRuns = false }) {
  const context = {
    filteredRuns: Array.from({ length: count }, (_, runId) => ({ runId })),
    RUNS_PAGE_SIZE: 25,
    runPage: page,
    hasOlderRuns,
    loadingMoreRuns,
    setRunPage: (value) => { context.runPage = value; },
    loadOlderRuns: async () => {
      fetches++;
      const batch = batches.shift() ?? { added: 0, more: false };
      const offset = context.filteredRuns.length;
      context.filteredRuns.push(...Array.from({ length: batch.added }, (_, i) => ({ runId: offset + i })));
      context.hasOlderRuns = batch.more;
      return batch.added;
    },
  };
  let fetches = 0;
  function render() {
    for (const name of ["runPageCount", "activeRunPage", "visibleRuns", "lastRunPageIsPartial"]) {
      context[name] = evaluate(declarations.get(name), context);
    }
    return context;
  }
  render();
  return {
    get fetches() { return fetches; },
    async next() {
      await evaluate(declarations.get("showNextRunPage"), context)();
      return render();
    },
    render,
  };
}

test("401 to 424 runs fills page 17 and leaves the exhausted final page selected", async () => {
  const pagination = runPagination({ count: 401, page: 16, batches: [{ added: 23, more: false }] });
  assert.equal(pagination.render().visibleRuns.length, 1);
  let state = await pagination.next();
  assert.equal(state.runPage, 16);
  assert.equal(state.runPageCount, 17);
  assert.equal(state.visibleRuns.length, 24);
  assert.equal(state.visibleRuns[0].runId, 400);
  state = await pagination.next();
  assert.equal(state.runPage, 16);
  assert.equal(pagination.fetches, 1);
});

test("new records fill page 17 before Next opens the newly loaded page 18", async () => {
  const pagination = runPagination({ count: 401, page: 16, batches: [{ added: 50, more: true }] });
  let state = await pagination.next();
  assert.equal(state.runPage, 16);
  assert.equal(state.visibleRuns.length, 25);
  assert.equal(state.visibleRuns[24].runId, 424);
  state = await pagination.next();
  assert.equal(state.runPage, 17);
  assert.equal(state.visibleRuns[0].runId, 425);
  assert.equal(pagination.fetches, 1);
});

test("a full last page loads and advances; an already loaded next page needs no request", async () => {
  const pagination = runPagination({ count: 400, page: 15, batches: [{ added: 50, more: false }] });
  let state = await pagination.next();
  assert.equal(state.runPage, 16);
  assert.equal(state.visibleRuns[0].runId, 400);
  state = await pagination.next();
  assert.equal(state.runPage, 17);
  assert.equal(state.visibleRuns[0].runId, 425);
  assert.equal(pagination.fetches, 1);
});

test("empty filtered results and repeated short batches stay on their page until filled", async () => {
  const pagination = runPagination({ count: 0, page: 0, batches: [
    { added: 0, more: true }, { added: 1, more: true }, { added: 24, more: true },
    { added: 3, more: false },
  ] });
  for (const size of [0, 1, 25]) {
    const state = await pagination.next();
    assert.equal(state.runPage, 0);
    assert.equal(state.visibleRuns.length, size);
  }
  const state = await pagination.next();
  assert.equal(state.runPage, 1);
  assert.equal(state.visibleRuns.length, 3);
});

test("empty/error fetch results, exhausted cursors and in-flight loads do not advance", async () => {
  for (const scenario of [
    { count: 400, page: 15, batches: [{ added: 0, more: true }], expectedFetches: 1 },
    { count: 424, page: 16, hasOlderRuns: false, expectedFetches: 0 },
    { count: 451, page: 16, loadingMoreRuns: true, expectedFetches: 0 },
  ]) {
    const pagination = runPagination(scenario);
    const state = await pagination.next();
    assert.equal(state.runPage, scenario.page);
    assert.equal(pagination.fetches, scenario.expectedFetches);
  }
});

test("Runs button distinguishes loading a partial page from navigating to the next page", () => {
  const context = {
    loadingMoreRuns: false, hasOlderRuns: true, activeRunPage: 16,
    runPageCount: 17, lastRunPageIsPartial: true,
  };
  assert.equal(evaluate(runNextLabel, context), "Load more");
  assert.equal(evaluate(runNextLabel, { ...context, loadingMoreRuns: true }), "Loading…");
  assert.equal(evaluate(runNextLabel, { ...context, activeRunPage: 15 }), "→");
  assert.equal(evaluate(runNextLabel, { ...context, lastRunPageIsPartial: false }), "→");
  const attribute = (name) => runNextButton.attributes.properties.find((node) => node.name.getText(ast) === name).initializer.expression;
  assert.equal(evaluate(attribute("aria-label"), context), "Load more runs");
  assert.equal(evaluate(attribute("aria-label"), { ...context, lastRunPageIsPartial: false }), "Next page");
  assert.equal(evaluate(attribute("disabled"), context), false);
  assert.equal(evaluate(attribute("disabled"), { ...context, hasOlderRuns: false }), true);
  assert.equal(evaluate(attribute("disabled"), { ...context, loadingMoreRuns: true }), true);
});
