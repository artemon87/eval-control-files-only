import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const helpers = {};
runInNewContext(
  compile(
    await readFile(
      new URL("../app/lib/unit-trend-explorer.ts", import.meta.url),
      "utf8",
    ),
  ),
  { exports: helpers },
);
const component = compile(
  await readFile(
    new URL(
      "../app/components/unit-trend-explorer-content.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
);
const walk = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(walk)
      : [node, ...walk(node.props?.children)];
async function harness({ compatible = false, referenceError = false } = {}) {
  const values = [];
  let cursor = 0,
    effects = [];
  const exported = {};
  const now = {
    runId: "new",
    branchKey: "main",
    branchLabel: "main",
    startedAt: "2026-11-02",
    cohortKey: "config",
    caseSetKey: "tests",
    qualityMeasured: true,
    total: 1,
    passed: 1,
    passRatePct: 100,
    verdict: "passed",
    bsaVersion: "1.18",
  };
  const old = {
    ...now,
    runId: "old",
    startedAt: "2026-11-01",
    passed: 0,
    passRatePct: 0,
    verdict: "failed",
    bsaVersion: compatible ? "1.18" : "1.17",
    cohortKey: compatible ? "config" : "older-config",
  };
  const cohorts = [
    { key: "config", configurationComplete: compatible },
    { key: "older-config", configurationComplete: false },
  ];
  const records = (id) => [
    {
      run_id: id,
      case_id: "a",
      test_name: "one test",
      test_type: "single",
      verdict: id === "new" ? "passed" : "failed",
      scores: { accuracy: id === "new" ? 5 : 0 },
      thresholds: { accuracy: 4 },
    },
  ];
  const calls = [];
  const api = {
    listUnitHistoryRunCases: async (id) => {
      calls.push(id);
      if (id === "old" && referenceError)
        throw Error("Reference request failed");
      return records(id);
    },
  };
  const react = {
    useState: (initial) => {
      const i = cursor++;
      if (!(i in values)) values[i] = initial;
      return [values[i], (value) => (values[i] = value)];
    },
    useEffect: (callback) => effects.push(callback),
  };
  runInNewContext(component, {
    exports: exported,
    AbortController,
    Error,
    require: (name) =>
      name === "react"
        ? react
        : name === "react/jsx-runtime"
          ? require(name)
          : name.endsWith("unit-trend-explorer")
            ? helpers
            : name.endsWith("unit-history-utils")
              ? { historyTime: (x) => x, rateLabel: (x) => `${x}%` }
              : name.endsWith(".css")
                ? { default: new Proxy({}, { get: (_, key) => key }) }
                : new Proxy({}, { get: () => () => null }),
  });
  const render = () => {
    cursor = 0;
    effects = [];
    return exported.UnitTrendExplorerContent({
      api,
      data: { runs: [now, old], cohorts, branches: [] },
      openingRunId: null,
      onOpenRun: () => {},
    });
  };
  let tree = render();
  values[3] = "all";
  const select = walk(tree).find(
    (node) => node.props?.["aria-label"] === "Reference execution",
  );
  select.props.onChange({ target: { value: "old" } });
  tree = render();
  await effects[0](); // effect schedules Promise.allSettled
  await new Promise((resolve) => setImmediate(resolve));
  tree = render();
  return {
    html: renderToStaticMarkup(tree),
    calls,
    helpers,
    now,
    old,
    cohorts,
    values,
    render,
  };
}
test("manual incompatible reference loads and displays actual evidence with explicit blockers", async () => {
  const { html, calls } = await harness();
  assert.deepEqual(calls, ["new", "old"]);
  assert.ok(html.includes("Reference result"));
  assert.ok(html.includes("Failed"));
  assert.ok(html.includes("Passed"));
  assert.ok(html.includes("Configuration metadata is incomplete"));
  assert.ok(html.includes("new · 2026-11-02"));
  assert.ok(html.includes("old · 2026-11-01"));
  assert.ok(!html.includes("<th>Observed change</th>"));
});
test("compatible reference still reports recovered tests", async () => {
  const { html } = await harness({ compatible: true });
  assert.ok(html.includes("<th>Observed change</th>"));
  assert.ok(html.includes("Recovered"));
});
test("no reference shows selected results only and failed reference fetch remains explicit", async () => {
  const h = await harness({ referenceError: true });
  assert.ok(h.html.includes("Reference request failed"));
  assert.ok(!h.html.includes("<th>Observed change</th>"));
  h.values[2] = "none";
  const html = renderToStaticMarkup(h.render());
  assert.ok(!html.includes("<th>Reference result</th>"));
  assert.ok(html.includes("Results for this run"));
});
