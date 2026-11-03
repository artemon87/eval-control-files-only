import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = await readFile(
  new URL("../app/components/unit-history-explorer.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const bounds = {
  startedFrom: "2026-10-01T00:00:00Z",
  startedBefore: "2026-11-03T00:00:00Z",
};
const scope = {
  scopeKey: "one",
  skill: "feedback",
  githubRepository: "org/repo",
  stage: "dev",
  targetEnvironment: "east",
  environment: "runner",
};
const walk = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(walk)
      : [node, ...walk(node.props?.children)];
test("all scopes are explicit defaults and widening the window preserves the configuration filter", () => {
  const values = [],
    effects = [];
  let cursor = 0;
  const exports = {};
  const react = {
    useEffect: (callback) => effects.push(callback),
    useState: (initial) => {
      const i = cursor++;
      if (!(i in values))
        values[i] =
          i === 6 ? { items: [scope], loaded: true, error: null } : initial;
      return [
        values[i],
        (next) =>
          (values[i] = typeof next === "function" ? next(values[i]) : next),
      ];
    },
  };
  const calls = [];
  runInNewContext(compiled, {
    exports,
    AbortController,
    require: (name) =>
      name === "react"
        ? react
        : name === "react/jsx-runtime"
          ? require(name)
          : name.endsWith("use-history-window")
            ? { useHistoryWindow: () => ({ window: bounds, loading: false }) }
            : name.endsWith("unit-history-utils")
              ? { skillScopeKey: (x) => x.skill + x.githubRepository }
              : name.endsWith(".css")
                ? { default: {} }
                : {},
  });
  const api = {
    getUnitHistoryInsights: async (query) => {
      calls.push(query);
      return {};
    },
    listUnitHistoryScopes: async () => [scope],
  };
  const render = () => {
    cursor = 0;
    effects.length = 0;
    return exports.UnitHistoryTrendExplorer({
      api,
      revision: 0,
      onShowE2E: () => {},
      openingRunId: null,
      onOpenRun: () => {},
    });
  };
  let tree = render();
  for (const label of ["History stage", "History target"])
    assert.equal(
      walk(tree).find((n) => n.props?.["aria-label"] === label).props.value,
      "all",
    );
  effects[1]();
  assert.equal(calls[0].allStages, true);
  assert.equal(calls[0].allTargets, true);
  values[5] = { key: "bsa118", scopeKey: "one", revision: 0 };
  tree = render();
  walk(tree)
    .find((n) => n.type === "button" && n.props.children === "90d")
    .props.onClick();
  assert.equal(values[0], "90d");
  assert.equal(values[5].key, "bsa118");
});
