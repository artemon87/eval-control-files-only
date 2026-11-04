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
function harness(count = 4, extraContext = false) {
  let cursor = 0,
    selected = `r${count - 1}`;
  const state = [],
    exports = {},
    compared = [];
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
  const rates = [50, 90, 50, 70];
  const runs = Array.from({ length: count }, (_, i) => ({
    runId: `r${i}`,
    branchLabel: i < 2 ? "branch-a" : "branch-b",
    sourceBranch: i < 2 ? "branch-a" : "branch-b",
    branchKey: i < 2 ? "a" : "b",
    startedAt: `2026-11-02T10:${String(i).padStart(2, "0")}:00Z`,
    stage: "dev",
    targetEnvironment: "east",
    environment: "runner",
    qualityMeasured: true,
    passRatePct: rates[i] ?? 70,
    total: 10,
    passed: (rates[i] ?? 70) / 10,
    durationMs: 1000,
    caseSetKey: "tests",
    bsaVersion: i < 2 ? "1.17" : "1.18",
  })).reverse();
  if (extraContext)
    runs.unshift({
      ...runs[0],
      runId: "west",
      targetEnvironment: "west",
      startedAt: "2026-11-03T10:00:00Z",
    });
  return {
    compared,
    render: (id = selected) => {
      cursor = 0;
      return exports.UnitSkillPerformanceTrend({
        data: { runs },
        selectedRunId: id,
        openingRunId: null,
        onOpenRun: () => {},
        onInspectRun: (id) => (selected = id),
        onCompare: (id) => compared.push(id),
      });
    },
  };
}
test("solid branch segments and dashed cross-branch handoff follow recorded execution order across versions", () => {
  const h = harness(),
    tree = h.render(),
    html = renderToStaticMarkup(tree);
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 4);
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-segment"]).length,
    2,
  );
  assert.equal(
    walk(tree).find((n) => n.props?.["data-trend-handoff"])?.props[
      "data-trend-handoff"
    ],
    "r1",
  );
  assert.ok(html.includes("↑ +20 pp"));
  assert.ok(html.includes("↓ -20 pp"));
  assert.ok(html.includes("BSA version 1.17 → 1.18"));
  const actions = walk(tree).filter(
    (n) => n.type === "button" && n.props.children === "Compare tests",
  );
  actions[1].props.onClick();
  assert.deepEqual(h.compared, ["r1"]);
});
test("branch legend supports several visible branches and selected branch card follows selected execution", () => {
  const h = harness();
  let tree = h.render();
  const legend = () =>
    walk(tree).find((n) => n.props?.["aria-label"] === "Trend branches");
  walk(legend())
    .find((n) => n.type === "button")
    .props.onClick();
  tree = h.render();
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 2);
  walk(legend())
    .find((n) => n.type === "button")
    .props.onClick();
  tree = h.render("r2");
  const cards = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Branch progression cards",
  );
  assert.ok(renderToStaticMarkup(cards).includes("Single run on this branch"));
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 4);
});
test("many same-day runs have distinct execution slots and exact timestamps remain inspectable", () => {
  const tree = harness(25).render();
  const links = walk(tree).filter((n) => n.props?.["data-trend-run"]);
  assert.equal(links.length, 25);
  const xs = links.map(
    (n) => walk(n).find((c) => c.type === "circle").props.cx,
  );
  assert.equal(new Set(xs).size, 25);
  assert.ok(
    links.every((n) => n.props["aria-label"].includes("2026-11-02T10:")),
  );
  assert.ok(
    !walk(tree).some((n) => n.props?.["aria-label"] === "Zoom into trend day"),
  );
});
test("context buttons focus stage and target without joining other contexts", () => {
  const h = harness(4, true);
  let tree = h.render();
  const contexts = walk(tree).find(
    (n) => n.props?.["aria-label"] === "Trend stage and target",
  );
  const west = walk(contexts).find(
    (n) => n.type === "button" && String(n.props.children).includes("west"),
  );
  west.props.onClick();
  tree = h.render();
  assert.equal(walk(tree).filter((n) => n.props?.["data-trend-run"]).length, 1);
  assert.equal(
    walk(tree).filter((n) => n.props?.["data-trend-handoff"]).length,
    0,
  );
});
