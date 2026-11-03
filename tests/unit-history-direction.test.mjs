import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const helper = {};
runInNewContext(
  compile(
    await readFile(
      new URL("../app/lib/unit-history-trend.ts", import.meta.url),
      "utf8",
    ),
  ),
  { exports: helper },
);
const code = compile(
  await readFile(
    new URL("../app/components/unit-history-trend.tsx", import.meta.url),
    "utf8",
  ),
);
const walk = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(walk)
      : [node, ...walk(node.props?.children)];
function harness(context = false, visibleRunIds = null, cross = false) {
  const values = [];
  let cursor = 0;
  const exports = {};
  const opened = [];
  runInNewContext(code, {
    exports,
    require: (name) =>
      name === "react"
        ? {
            useState: (initial) => {
              const i = cursor++;
              if (!(i in values)) values[i] = initial;
              return [
                values[i],
                (v) => (values[i] = typeof v === "function" ? v(values[i]) : v),
              ];
            },
            useRef: () => ({ current: null }),
            useEffect: () => {},
          }
        : name === "react/jsx-runtime"
          ? require(name)
          : name.endsWith("unit-history-trend")
            ? helper
            : name.endsWith("unit-history-utils")
              ? { historyTime: (x) => x, rateLabel: (x) => `${x}%` }
              : { default: new Proxy({}, { get: (_, key) => key }) },
  });
  const runs = Array.from({ length: 25 }, (_, i) => ({
    runId: `run-${i}`,
    branchKey: "branch",
    branchLabel: "feature/a · dev · east",
    startedAt: `2026-11-02T10:${String(i).padStart(2, "0")}:00Z`,
    executionStatus: "completed",
    qualityMeasured: true,
    cohortKey: i < 10 ? "old" : "new",
    caseSetKey: "same",
    passRatePct: i < 10 ? 80 : 90,
    durationMs: 1000,
    total: 10,
    passed: i < 10 ? 8 : 9,
    trendPreviousRunId: i ? `run-${i - 1}` : null,
    trendTransition: !i
      ? "first"
      : i === 10
        ? "settings_changed"
        : "comparable",
    trendPassRateDelta: !i || i === 10 ? null : 0,
    trendDurationDeltaMs: 0,
  })).reverse();
  if (context) {
    const template = runs[0];
    runs.splice(
      0,
      runs.length,
      ...Array.from({ length: 5 }, (_, i) => ({
        ...template,
        runId: `context-${i}`,
        branchKey: `context-series-${i}`,
        branchLabel: `${i === 4 ? "other-branch" : "feature/a"} · stage-${i} · target-${i}`,
        startedAt: `2026-10-${String(5 + i * 6).padStart(2, "0")}T10:00:00Z`,
        trendPreviousRunId: null,
        trendTransition: "first",
        trendPassRateDelta: null,
        trendContextPreviousRunId: i > 0 && i < 4 ? `context-${i - 1}` : null,
        trendContextChanges:
          i > 0 && i < 4 ? ["Stage changed", "Target changed"] : [],
        trendNote:
          "No earlier run in this branch, stage and target within the selected window.",
      })).reverse(),
    );
  }
  if (cross) {
    const template = runs[0];
    runs.splice(
      0,
      runs.length,
      ...Array.from({ length: 3 }, (_, i) => ({
        ...template,
        runId: `cross-${i}`,
        sourceBranch: i === 1 ? "branch-b" : "branch-a",
        branchKey: i === 1 ? "branch-b" : "branch-a",
        branchLabel: i === 1 ? "branch-b" : "branch-a",
        cohortKey: "old",
        trendTransition: "first",
        trendPreviousRunId: null,
        startedAt: `2026-11-02T1${i}:00:00Z`,
        trendReferences:
          i === 0
            ? []
            : i === 1
              ? [
                  {
                    runId: "cross-0",
                    branch: "branch-a",
                    startedAt: "2026-11-02T10:00:00Z",
                    passRateDelta: 10,
                    durationDeltaMs: -100,
                  },
                ]
              : [
                  {
                    runId: "cross-1",
                    branch: "branch-b",
                    startedAt: "2026-11-02T11:00:00Z",
                    passRateDelta: -10,
                    durationDeltaMs: 100,
                  },
                  {
                    runId: "cross-0",
                    branch: "branch-a",
                    startedAt: "2026-11-02T10:00:00Z",
                    passRateDelta: 0,
                    durationDeltaMs: 0,
                  },
                ],
      })).reverse(),
    );
  }
  const data = {
    runs,
    scope: { skill: "feedback" },
    startedFrom: "2026-10-04T00:00:00Z",
    startedBefore: context ? "2026-11-06T00:00:00Z" : "2026-11-03T00:00:00Z",
    cohorts: [
      { key: "old", configurationComplete: true },
      { key: "new", configurationComplete: true },
    ],
    branches:
      context || cross
        ? [
            ...new Map(
              runs.map((run) => [
                run.branchKey,
                { key: run.branchKey, label: run.branchLabel },
              ]),
            ).values(),
          ]
        : [{ key: "branch", label: "feature/a · dev · east" }],
  };
  const render = () => {
    cursor = 0;
    return exports.UnitSkillPerformanceTrend({
      data,
      visibleRunIds,
      focusedBranch: null,
      openingRunId: null,
      onHighlightBranch: () => {},
      onOpenRun: (id) => opened.push(id),
      onInspectRun: (id) => opened.push(id),
    });
  };
  return { render, opened };
}
test("chart draws a settings boundary and day zoom retains every execution with pagination", () => {
  const h = harness();
  let tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-run"]).length,
    25,
  );
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-direction"] === "changed")
      .length,
    1,
  );
  const select = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Zoom into trend day",
  );
  select.props.onChange({ target: { value: "2026-11-02" } });
  tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-run"]).length,
    25,
  );
  const list = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Day executions",
  );
  const rows = walk(list).filter(
    (n) => n.type === "button" && "aria-pressed" in n.props,
  );
  assert.equal(rows.length, 20);
  rows[0].props.onClick();
  assert.deepEqual(h.opened, ["run-24"]);
  walk(list)
    .find((n) => n.type === "button" && n.props.children === "Next runs")
    .props.onClick();
  tree = h.render();
  const last = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Day executions",
  );
  assert.equal(
    walk(last).filter((n) => n.type === "button" && "aria-pressed" in n.props)
      .length,
    5,
  );
  assert.ok(renderToStaticMarkup(tree).includes("Day detail"));
});

test("single-point context series connect only through optional server chronology links", () => {
  const h = harness(true);
  let tree = h.render();
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 5);
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-context-link"]).length,
    3,
  );
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-direction"]).length,
    0,
  );
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-isolated"]).length,
    1,
  );
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes("Stage / target changed"));
  assert.ok(html.includes("chronology only, no performance comparison"));
  const toggle = walk(tree).find(
    (n) => n.type === "input" && n.props.type === "checkbox",
  );
  toggle.props.onChange({ target: { checked: false } });
  tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-context-link"]).length,
    0,
  );
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 5);
  assert.ok(walk(tree).some((n) => n.props?.["data-trend-isolated"]));
});

test("chronology never bridges a missing visible endpoint", () => {
  const point = (id, previous) => ({
    run: {
      runId: id,
      trendContextPreviousRunId: previous,
      trendContextChanges: ["Stage changed"],
    },
    value: 80,
  });
  assert.equal(
    helper.historyContextConnections([
      { points: [point("a", null), point("c", "b")] },
    ]).length,
    0,
  );
  assert.equal(
    helper.historyContextConnections([
      { points: [point("b", null), point("c", "b")] },
    ]).length,
    1,
  );
});

test("settings filter includes executions from multiple underlying comparison cohorts", () => {
  const h = harness(false, ["run-0", "run-10"]);
  const tree = h.render();
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 2);
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-direction"]).length,
    0,
  );
});

test("cross-branch reference modes render backend deltas and exact branch choice", () => {
  const h = harness(false, null, true);
  let tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-direction"]).length,
    2,
  );
  assert.ok(renderToStaticMarkup(tree).includes("branch-b"));
  walk(tree)
    .find((n) => n.props?.["aria-label"] === "Trend comparison mode")
    .props.onChange({ target: { value: "same" } });
  tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-direction"]).length,
    0,
  );
  walk(tree)
    .find((n) => n.props?.["aria-label"] === "Trend comparison mode")
    .props.onChange({ target: { value: "branch" } });
  tree = h.render();
  walk(tree)
    .find((n) => n.props?.["aria-label"] === "Trend reference branch")
    .props.onChange({ target: { value: "branch-a" } });
  tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-direction"] === "same")
      .length,
    1,
  );
});
