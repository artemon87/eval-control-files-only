import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const compile = (s) =>
  ts.transpileModule(s, {
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
const walk = (n) =>
  !n || typeof n !== "object"
    ? []
    : Array.isArray(n)
      ? n.flatMap(walk)
      : [n, ...walk(n.props?.children)];
function harness(count = 4) {
  let cursor = 0;
  const state = [],
    exports = {},
    opened = [];
  runInNewContext(code, {
    exports,
    require: (name) =>
      name === "react"
        ? {
            useState: (initial) => {
              const i = cursor++;
              if (!(i in state)) state[i] = initial;
              return [
                state[i],
                (v) => (state[i] = typeof v === "function" ? v(state[i]) : v),
              ];
            },
            useEffect: () => {},
            useRef: () => ({ current: null }),
          }
        : name === "react/jsx-runtime"
          ? require(name)
          : name.endsWith("unit-history-trend")
            ? helper
            : name.endsWith("unit-history-utils")
              ? { historyTime: (s) => s }
              : { default: new Proxy({}, { get: (_, k) => k }) },
  });
  const ref = (id, d) => ({
    runId: id,
    branch: id.startsWith("a") ? "branch-a" : "branch-b",
    startedAt: "2026-11-02T09:00:00Z",
    passRateDelta: d,
    durationDeltaMs: -100,
    warnings: ["mode not fully recorded"],
  });
  const values = [50, 90, 50, 70];
  const runs = Array.from({ length: count }, (_, i) => ({
    runId: i < 2 ? `a${i}` : `b${i}`,
    branchKey: i < 2 ? "branch-a" : "branch-b",
    sourceBranch: i < 2 ? "branch-a" : "branch-b",
    branchLabel: i < 2 ? "branch-a" : "branch-b",
    stage: "dev",
    targetEnvironment: "east",
    environment: "runner",
    startedAt: `2026-11-02T10:${String(i).padStart(2, "0")}:00Z`,
    executionStatus: "completed",
    qualityMeasured: true,
    passRatePct: values[i] ?? 70,
    durationMs: 1000,
    cohortKey: "setting",
    caseSetKey: "tests",
    progression: {
      key: "dev/east/setting",
      label: "dev/east",
      previousExecution: i
        ? ref(
            i === 1 ? "a0" : i === 2 ? "a1" : `b${i - 1}`,
            (values[i] ?? 70) - (values[i - 1] ?? 70),
          )
        : null,
      previousSameBranch:
        i === 1
          ? ref("a0", 40)
          : i >= 3
            ? ref(`b${i - 1}`, i === 3 ? 20 : 0)
            : null,
      previousBranch: i >= 2 ? ref("a1", (values[i] ?? 70) - 90) : null,
      branchStart:
        i >= 2
          ? ref("b2", (values[i] ?? 70) - 50)
          : ref("a0", (values[i] ?? 70) - 50),
    },
  })).reverse();
  const data = {
    runs,
    branches: [
      { key: "branch-a", label: "branch-a · dev · east" },
      { key: "branch-b", label: "branch-b · dev · east" },
    ],
    cohorts: [{ key: "setting", configurationComplete: false }],
    startedFrom: "2026-11-01T00:00:00Z",
    startedBefore: "2026-11-04T00:00:00Z",
  };
  return {
    opened,
    render: (selected = "b3") => {
      cursor = 0;
      return exports.UnitSkillPerformanceTrend({
        data,
        selectedRunId: selected,
        focusedBranch: null,
        onHighlightBranch: () => {},
        openingRunId: null,
        onOpenRun: (id) => opened.push(id),
        onInspectRun: (id) => opened.push(id),
      });
    },
  };
}
test("continuous timeline crosses branches despite missing optional mode; shows both references", () => {
  const h = harness();
  const tree = h.render();
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 4);
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-direction"]).length,
    3,
  );
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes("↑ +20 pp"));
  assert.ok(html.includes("↓ -20 pp"));
  assert.ok(html.includes("mode not fully recorded"));
  assert.ok(html.includes("VS PREVIOUS BRANCH"));
});
test("branch cards select actual final runs; multi-select preserves visible series", () => {
  const h = harness();
  let tree = h.render();
  const cards = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Branch progression cards",
  );
  const card = walk(cards).filter((n) => n.type === "button")[0];
  card.props.onClick();
  assert.deepEqual(h.opened, ["a1"]);
  const legend = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Trend branch highlights",
  );
  walk(legend)
    .filter((n) => n.type === "button")[0]
    .props.onClick();
  tree = h.render();
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 2);
  const next = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Trend branch highlights",
  );
  walk(next)
    .filter((n) => n.type === "button")[1]
    .props.onClick();
  assert.equal(
    walk(h.render()).filter((n) => n.props?.["data-trend-run"]).length,
    4,
  );
});
test("day detail preserves every execution and paginates dense days", () => {
  const h = harness(25);
  let tree = h.render();
  walk(tree)
    .find((n) => n.props?.["aria-label"] === "Zoom into trend day")
    .props.onChange({ target: { value: "2026-11-02" } });
  tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-run"]).length,
    25,
  );
  let list = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Day executions",
  );
  assert.equal(
    walk(list).filter((n) => n.type === "button" && "aria-pressed" in n.props)
      .length,
    20,
  );
  walk(list)
    .find((n) => n.type === "button" && n.props.children === "Next runs")
    .props.onClick();
  list = walk(h.render()).find(
    (n) => n.props?.["aria-label"] === "Day executions",
  );
  assert.equal(
    walk(list).filter((n) => n.type === "button" && "aria-pressed" in n.props)
      .length,
    5,
  );
});
