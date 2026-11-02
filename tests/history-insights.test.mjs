import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../app/lib/eval-api.ts", import.meta.url),
  "utf8",
);
function apiModule(fetch) {
  const exports = {};
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });
  runInNewContext(outputText, {
    exports,
    fetch,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  return new exports.EvalApi("/api");
}
const query = {
  evalType: "unit",
  range: "30d",
  repository: "org/payroll",
  category: "HR",
  stage: "prod",
  targetEnvironment: "east",
  scope: "skill / a",
  baseline: "feature/test",
  windowEnd: "2026-10-31T00:00:00Z",
};
const wire = () => ({
  window: {
    startedFrom: "2026-10-01T00:00:00Z",
    startedBefore: "2026-10-31T00:00:00Z",
  },
  landscape: {
    cells: { "skill\u0000main": { scope: "skill", branch: "main" } },
    insights: [],
  },
  matrix: { cells: { "test\u0000main": { state: "regression" } }, tests: [] },
});

test("Insights sends scope and server range/anchor without calculating client dates", async () => {
  let request;
  const api = apiModule(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => wire() };
  });
  await api.getEvaluationInsights(query);
  const url = new URL(request.url, "https://test");
  assert.equal(url.pathname, "/api/history/insights");
  for (const [key, value] of Object.entries({
    eval_type: "unit",
    range: "30d",
    repository: "org/payroll",
    category: "HR",
    stage: "prod",
    target_environment: "east",
    scope: "skill / a",
    baseline: "feature/test",
    window_end: query.windowEnd,
  }))
    assert.equal(url.searchParams.get(key), value);
  assert.equal(url.searchParams.has("started_from"), false);
  assert.equal(url.searchParams.has("started_before"), false);
});

test("server classification cells hydrate without reclassifying or dropping null matrices", async () => {
  const api = apiModule(async () => ({ ok: true, json: async () => wire() }));
  const result = await api.getEvaluationInsights(query);
  assert.equal(result.matrix.cells.get("test\u0000main").state, "regression");
  assert.equal(result.landscape.cells.get("skill\u0000main").branch, "main");
  const empty = apiModule(async () => ({
    ok: true,
    json: async () => ({ ...wire(), matrix: null }),
  }));
  assert.equal(
    (await empty.getEvaluationInsights({ ...query, evalType: "e2e" })).matrix,
    null,
  );
});

test("API failure stays an error instead of invoking browser analytics", async () => {
  const api = apiModule(async () => ({
    ok: false,
    status: 413,
    text: async () => "Narrow the window",
  }));
  await assert.rejects(
    api.getEvaluationInsights(query),
    /413.*Narrow the window/,
  );
});

test("caller cancellation reaches the Insights request", async () => {
  let signal;
  const api = apiModule((_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted"))),
    );
  });
  const controller = new AbortController();
  const pending = api.getEvaluationInsights(query, controller.signal);
  controller.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(signal.aborted, true);
});

test("Insights UI consumes server results and keeps analysis out of the browser", async () => {
  const ui = await readFile(
    new URL("../app/components/history-insights.tsx", import.meta.url),
    "utf8",
  );
  const types = await readFile(
    new URL("../app/lib/history-insights.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    ui,
    /fixedTimeWindow|listRunBatch|listCases|buildLandscape|buildTestMatrix|runsForCaseLoad/,
  );
  assert.doesNotMatch(
    types,
    /function (buildLandscape|buildTestMatrix|countFlips|pickBaselineBranch)/,
  );
});

test("Trend Explorer requests server window resolution using only its preset and anchor", async () => {
  const urls = [];
  const window = {
    startedFrom: "2026-10-24T00:00:00Z",
    startedBefore: "2026-10-31T00:00:00Z",
  };
  const api = apiModule(async (url) => {
    urls.push(new URL(url, "https://test"));
    return { ok: true, json: async () => window };
  });
  assert.deepEqual(await api.getHistoryWindow("7d"), window);
  await api.getHistoryWindow("7d", window.startedBefore);
  assert.equal(urls[0].pathname, "/api/history/window");
  assert.equal(urls[0].searchParams.has("window_end"), false);
  assert.equal(urls[1].searchParams.get("window_end"), window.startedBefore);
  assert.equal(urls[1].searchParams.has("started_from"), false);
});

test("Repository stays rendered for zero, one and multiple repositories; loading retains results", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const uiSource = await readFile(
    new URL("../app/components/history-insights.tsx", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(uiSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require: (name) =>
      name.endsWith(".css")
        ? { default: {} }
        : name === "../lib/history-insights"
          ? {
              cellKey: (a, b) => `${a}\u0000${b}`,
              runContext: (r) => r.context,
            }
          : require(name),
  });
  const data = {
    repositories: [],
    categories: [],
    scopeOptions: [],
    stageOptions: [],
    targetOptions: [],
    branchNames: [],
    activeCategory: "all",
    activeStage: "all",
    activeTarget: "all",
    activeScope: null,
    baseline: null,
    mixedStages: 1,
    mixedTargets: 1,
    counts: {
      runCount: 1,
      scopeCount: 0,
      branchCount: 0,
      regressedCells: 0,
      systemicScopes: 0,
    },
    landscape: { scopes: [], branches: [], cells: new Map(), insights: [] },
    matrix: null,
  };
  for (const repositories of [[], ["org/a"], ["org/a", "org/b"]]) {
    const snapshot = {
      evalType: "unit",
      range: "90d",
      loaded: {
        key: JSON.stringify([
          "unit",
          "30d",
          0,
          "org/selected",
          null,
          null,
          "all",
          null,
          null,
        ]),
        data: { ...data, repositories },
        error: null,
      },
      repository: "org/selected",
    };
    const html = renderToStaticMarkup(
      React.createElement(exports.HistoryInsights, {
        api: {},
        initialFocus: null,
        snapshot,
        onSnapshot: () => {},
        openingRunId: null,
        onOpenRun: () => {},
      }),
    );
    assert.match(html, /aria-label="Insights repository"/);
    assert.match(html, /<option value="org\/selected" selected=""/);
    assert.match(html, /aria-label="Insights results" aria-busy="true"/);
    assert.match(html, /inert=""/);
    assert.match(html, /Updating… showing previous results/);
  }
});
