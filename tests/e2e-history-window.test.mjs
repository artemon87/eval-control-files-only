import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const fn = ast.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name.text === "E2EHistoryCollection",
);
const code = ts.transpileModule("export " + fn.getText(ast), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const walk = (n) =>
  !n || typeof n !== "object"
    ? []
    : Array.isArray(n)
      ? n.flatMap(walk)
      : [n, ...walk(n.props?.children)];
function harness() {
  let cursor = 0;
  const state = [],
    calls = [],
    exports = {};
  const ready = {
    window: {
      startedFrom: "2026-10-01T00:00:00Z",
      startedBefore: "2026-11-01T00:00:00Z",
    },
    loading: false,
    error: null,
  };
  const collection = { loaded: true, loading: false, error: null, runs: [] };
  runInNewContext(code, {
    exports,
    require,
    useState: (initial) => {
      let i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [
        state[i],
        (v) => (state[i] = typeof v === "function" ? v(state[i]) : v),
      ];
    },
    useHistoryWindow: (api, range, revision, refresh) => {
      calls.push({ range, revision, refresh });
      return ready;
    },
    useRunCollection: () => collection,
    HistoryView: () => null,
  });
  return {
    ready,
    collection,
    calls,
    render: () => {
      cursor = 0;
      return exports.E2EHistoryCollection({
        api: {},
        revision: 3,
        onShowUnit: () => {},
        initialFocus: {},
        openingRunId: null,
        onOpenRun: () => {},
      });
    },
  };
}
test("loaded E2E history receives working range and refresh controls in its filter view", () => {
  const h = harness();
  let tree = h.render();
  let view = walk(tree).find((n) => typeof n.type === "function");
  assert.ok(view.props.windowControls);
  assert.ok(
    !walk(tree).some((n) =>
      String(n.props?.className).includes("history-controls--pending"),
    ),
  );
  const buttons = walk(view.props.windowControls).filter(
    (n) => n.type === "button",
  );
  buttons.find((n) => n.props.children === "30d").props.onClick();
  h.render();
  assert.equal(h.calls.at(-1).range, "30d");
  buttons.find((n) => n.props.children === "↻ Refresh").props.onClick();
  h.render();
  assert.equal(h.calls.at(-1).refresh, 1);
  assert.equal(h.calls.at(-1).revision, 3);
});
test("loading and failed E2E requests retain range controls for recovery", () => {
  const h = harness();
  h.collection.loaded = false;
  h.collection.loading = true;
  let tree = h.render();
  assert.equal(
    walk(tree).filter((n) => n.props?.className === "history-window-controls")
      .length,
    1,
  );
  assert.ok(walk(tree).some((n) => n.props?.role === "status"));
  h.collection.loading = false;
  h.collection.error = "Request failed";
  tree = h.render();
  assert.ok(
    walk(tree).some(
      (n) => n.props?.role === "alert" && n.props.children === "Request failed",
    ),
  );
  assert.equal(
    walk(tree).filter((n) => n.props?.className === "history-window-controls")
      .length,
    1,
  );
});
