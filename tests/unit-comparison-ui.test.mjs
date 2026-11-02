import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);
const page = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "page.tsx",
  page,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const scopeText = await readFile(
  new URL("../app/lib/comparison-scope.ts", import.meta.url),
  "utf8",
);
const scopes = {};
runInNewContext(
  ts.transpileModule(scopeText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  { exports: scopes },
);
const names = ["UnitRunComparison", "RunPairPicker", "ComparisonRunDetails"];
const source = ast.statements
  .filter((n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text))
  .map((n) => n.getText(ast))
  .join("\n");
const compiled = ts.transpileModule(
  source +
    "\nexports.components = {UnitRunComparison, RunPairPicker, ComparisonRunDetails};",
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
);
assert.equal(compiled.diagnostics?.length ?? 0, 0);
let values, cursor;
const exports = {};
runInNewContext(compiled.outputText, {
  exports,
  require,
  ...scopes,
  useState: (initial) => {
    const index = cursor++;
    return [values[index] ?? initial, (v) => (values[index] = v)];
  },
  useEffect: () => {},
  formatTime: (x) => x,
  shortGitSha: (x) => x?.slice(0, 7) || "Not recorded",
  summarizeCases: () => [],
  ComparisonResults: () => null,
});
const { UnitRunComparison, RunPairPicker } = exports.components;
const fixture = (runId, stage, target) => ({
  runId,
  stage,
  target: "payroll",
  environment: "staging",
  evalType: "unit",
  executionStatus: "completed",
  githubRepository: "org/repo",
  gitRef: "feature/" + "long-branch-name-".repeat(12),
  gitSha: "1234567890abcdef",
  startedAt: "2026-11-02T00:00:00Z",
  unitConfig: {
    skillId: "payroll",
    stage,
    targetEnvironment: target,
    skillVersion: "1.0.1",
    category: "domain",
  },
  summary: { passRatePct: 100 },
  suites: [],
});
const runs = [
  fixture("unit-baseline-" + "a".repeat(100), "1-dev", "east"),
  fixture("unit-candidate-" + "b".repeat(100), "3-preprod", "west"),
];
const walk = (node, predicate) => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n) => walk(n, predicate));
  return [
    ...(predicate(node) ? [node] : []),
    ...walk(node.props?.children, predicate),
  ];
};
test("changing candidate stage leaves baseline intact and scopes each run picker", () => {
  values = [];
  cursor = 0;
  const render = () => {
    cursor = 0;
    return UnitRunComparison({
      runs,
      selection: { skill: "payroll", github_repository: "org/repo" },
      api: null,
      onError: () => {},
    });
  };
  let tree = render();
  const control = (label) =>
    walk(
      tree,
      (n) => n.type === "select" && n.props["aria-label"] === label,
    )[0];
  assert.equal(control("Baseline stage").props.value, "1-dev");
  control("Candidate stage").props.onChange({ target: { value: "3-preprod" } });
  tree = render();
  assert.equal(control("Baseline stage").props.value, "1-dev");
  assert.equal(control("Candidate stage").props.value, "3-preprod");
  const picker = walk(tree, (n) => n.type === RunPairPicker)[0];
  assert.equal(picker.props.comparable[0].runId, runs[0].runId);
  assert.equal(picker.props.candidateComparable[0].runId, runs[1].runId);
  assert.equal(
    walk(tree, (n) => n.props?.["aria-label"] === "Compare category").length,
    0,
  );
});
test("run cards retain full metadata outside concise accessible run selectors", () => {
  values = [];
  cursor = 0;
  const tree = RunPairPicker({
    comparable: [runs[0]],
    candidateComparable: [runs[1]],
    unitRuns: true,
    api: null,
    onError: () => {},
  });
  const html = renderToStaticMarkup(tree);
  for (const run of runs) {
    assert.ok(html.includes(run.runId));
    assert.ok(html.includes(run.gitRef));
  }
  assert.ok(html.includes('aria-label="Baseline run"'));
  assert.ok(html.includes('aria-label="Candidate run"'));
  assert.ok(html.includes("1234567"));
  assert.equal((html.match(/class="compare-run-card"/g) || []).length, 2);
  const options = walk(tree, (n) => n.type === "option");
  assert.ok(
    options.every((n) => !n.props.children.includes("long-branch-name")),
  );
});
