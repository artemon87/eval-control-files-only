import type { CaseVerdict, EvalCase, EvalRun, EvalType } from "./eval-types";

// Pure analysis of the runs and cases loaded by History Insights; no API calls.
export const UNRECORDED_BRANCH = "(no branch recorded)";
export const REGRESSION_POINTS = 5;
export const ENVIRONMENT_GAP_POINTS = 10;
const BASELINE_CANDIDATES = ["main", "master", "develop", "dev"];
export type Outcome = "pass" | "fail" | "error" | "skip";
export type CellState =
  "pass" | "fail" | "regression" | "fixed" | "flaky" | "missing";
export type InsightSeverity = "critical" | "warning" | "good" | "info";
export type Insight = {
  id: string;
  severity: InsightSeverity;
  kind:
    | "bottleneck"
    | "branch-regression"
    | "branch-fix"
    | "flaky"
    | "systemic"
    | "baseline-drift"
    | "concentration"
    | "coverage"
    | "environment-gap";
  title: string;
  detail: string;
  scope?: string;
  branch?: string;
  testKey?: string;
};
export function normalizeBranch(gitRef?: string): string {
  const ref = gitRef?.trim();
  if (!ref) return UNRECORDED_BRANCH;
  const pull = ref.match(/^refs\/pull\/(\d+)\//);
  if (pull) return `PR #${pull[1]}`;
  return ref.replace(/^refs\/(heads|tags)\//, "");
}
export function runBranch(run: EvalRun): string {
  return normalizeBranch(run.gitRef);
}
export function runScopeKey(run: EvalRun): string {
  return run.evalType === "e2e"
    ? run.target
    : (run.unitConfig?.skillId ?? run.target);
}
export function runCategory(run: EvalRun): string {
  return run.unitConfig?.category?.trim() || "Uncategorized";
}
export function runTargetEnvironment(run: EvalRun): string {
  return run.unitConfig?.targetEnvironment?.trim() || "Target not recorded";
}
export function runContext(run: EvalRun): string {
  return run.evalType === "e2e"
    ? run.stage
    : `${run.stage} · ${runTargetEnvironment(run)}`;
}
export function isInsightRun(run: EvalRun): boolean {
  return (
    ["completed", "blocked", "error"].includes(run.executionStatus) &&
    run.summary.total > 0
  );
}
export function pickBaselineBranch(runs: EvalRun[]): string | null {
  const counts = new Map<string, number>();
  runs.forEach((run) => {
    const branch = runBranch(run);
    counts.set(branch, (counts.get(branch) ?? 0) + 1);
  });
  const conventional = BASELINE_CANDIDATES.find((name) => counts.has(name));
  if (conventional) return conventional;
  const ranked = [...counts.entries()]
    .filter(([branch]) => branch !== UNRECORDED_BRANCH)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? counts.keys().next().value ?? null;
}
function byStartedAt(a: EvalRun, b: EvalRun) {
  return a.startedAt.localeCompare(b.startedAt);
}
function caseOutcome(verdict: CaseVerdict): Outcome {
  if (verdict === "passed" || verdict === "xpassed") return "pass";
  if (verdict === "failed") return "fail";
  if (verdict === "skipped") return "skip";
  return "error";
}
function isFailing(outcome: Outcome) {
  return outcome === "fail" || outcome === "error";
}
function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function listNames(names: string[], limit = 3) {
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit
    ? `${shown} +${names.length - limit} more`
    : shown;
}
export type ScopeBranchCell = {
  scope: string;
  branch: string;
  runs: EvalRun[];
  latest: EvalRun;
  latestPassRate: number;
  meanPassRate: number;
  deltaVsBaseline: number | null;
  regressed: boolean;
  improved: boolean;
};
export type ScopeRow = {
  scope: string;
  baselinePassRate: number | null;
  branchesRegressed: number;
  worstBranch: { branch: string; passRate: number } | null;
  meanPassRate: number;
  runCount: number;
  systemic: boolean;
};
export type BranchColumn = {
  branch: string;
  isBaseline: boolean;
  scopesRegressed: number;
  scopesImproved: number;
  runCount: number;
  meanPassRate: number;
  lastRunAt: string;
  actors: string[];
};
export type Landscape = {
  scopes: ScopeRow[];
  branches: BranchColumn[];
  cells: Map<string, ScopeBranchCell>;
  insights: Insight[];
};
export function cellKey(row: string, branch: string) {
  return `${row}\u0000${branch}`;
}
function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}
export function buildLandscape(
  runs: EvalRun[],
  baseline: string | null,
  evalType: EvalType,
): Landscape {
  const grouped = new Map<string, EvalRun[]>();
  runs.forEach((run) => {
    const key = cellKey(runScopeKey(run), runBranch(run));
    grouped.set(key, [...(grouped.get(key) ?? []), run]);
  });
  const cells = new Map<string, ScopeBranchCell>();
  grouped.forEach((cellRuns, key) => {
    const sorted = [...cellRuns].sort(byStartedAt);
    const latest = sorted[sorted.length - 1];
    cells.set(key, {
      scope: runScopeKey(latest),
      branch: runBranch(latest),
      runs: sorted,
      latest,
      latestPassRate: latest.summary.passRatePct,
      meanPassRate: mean(sorted.map((run) => run.summary.passRatePct)),
      deltaVsBaseline: null,
      regressed: false,
      improved: false,
    });
  });
  cells.forEach((cell) => {
    if (!baseline || cell.branch === baseline) return;
    const base = cells.get(cellKey(cell.scope, baseline));
    if (!base) return;
    const context = runContext(cell.latest);
    const reference =
      base.runs.filter((run) => runContext(run) === context).at(-1) ??
      base.latest;
    cell.deltaVsBaseline = cell.latestPassRate - reference.summary.passRatePct;
    cell.regressed = cell.deltaVsBaseline <= -REGRESSION_POINTS;
    cell.improved = cell.deltaVsBaseline >= REGRESSION_POINTS;
  });
  const scopeNames = Array.from(
    new Set([...cells.values()].map((c) => c.scope)),
  );
  const branchNames = Array.from(
    new Set([...cells.values()].map((c) => c.branch)),
  );
  const allCells = [...cells.values()];
  const scopes: ScopeRow[] = scopeNames.map((scope) => {
    const row = allCells.filter((cell) => cell.scope === scope);
    const base = baseline ? cells.get(cellKey(scope, baseline)) : undefined;
    const worst = [...row].sort(
      (a, b) => a.latestPassRate - b.latestPassRate,
    )[0];
    return {
      scope,
      baselinePassRate: base?.latestPassRate ?? null,
      branchesRegressed: row.filter((cell) => cell.regressed).length,
      worstBranch: worst
        ? { branch: worst.branch, passRate: worst.latestPassRate }
        : null,
      meanPassRate: mean(row.map((cell) => cell.latestPassRate)),
      runCount: row.reduce((total, cell) => total + cell.runs.length, 0),
      systemic:
        row.length >= 2 &&
        row.every((cell) => cell.latest.verdict !== "passed") &&
        (base === undefined || base.latest.verdict !== "passed"),
    };
  });
  scopes.sort(
    (a, b) =>
      b.branchesRegressed - a.branchesRegressed ||
      a.meanPassRate - b.meanPassRate ||
      a.scope.localeCompare(b.scope),
  );
  const branches: BranchColumn[] = branchNames.map((branch) => {
    const column = allCells.filter((cell) => cell.branch === branch);
    const branchRuns = column.flatMap((cell) => cell.runs);
    return {
      branch,
      isBaseline: branch === baseline,
      scopesRegressed: column.filter((cell) => cell.regressed).length,
      scopesImproved: column.filter((cell) => cell.improved).length,
      runCount: branchRuns.length,
      meanPassRate: mean(column.map((cell) => cell.latestPassRate)),
      lastRunAt:
        branchRuns
          .map((run) => run.startedAt)
          .sort()
          .at(-1) ?? "",
      actors: Array.from(
        new Set(
          branchRuns
            .map((run) => run.actor)
            .filter((actor) => actor && actor !== "unknown"),
        ),
      ),
    };
  });
  branches.sort(
    (a, b) =>
      Number(b.isBaseline) - Number(a.isBaseline) ||
      b.scopesRegressed - a.scopesRegressed ||
      b.lastRunAt.localeCompare(a.lastRunAt),
  );
  const noun = evalType === "unit" ? "skill" : "target";
  const insights: Insight[] = [];
  scopes
    .filter((row) => row.systemic)
    .forEach((row) =>
      insights.push({
        id: `systemic:${row.scope}`,
        severity: "critical",
        kind: "systemic",
        scope: row.scope,
        title: `${row.scope} is failing on every branch${baseline ? `, including ${baseline}` : ""}`,
        detail: `Average latest pass rate is ${row.meanPassRate.toFixed(0)}%. The problem is in the ${noun} or its test data, not in any single branch.`,
      }),
    );
  scopes
    .filter((row) => row.branchesRegressed > 0 && !row.systemic)
    .slice(0, 4)
    .forEach((row) => {
      const regressed = allCells
        .filter((cell) => cell.scope === row.scope && cell.regressed)
        .sort((a, b) => (a.deltaVsBaseline ?? 0) - (b.deltaVsBaseline ?? 0));
      const worst = regressed[0];
      insights.push({
        id: `scope-regression:${row.scope}`,
        severity: regressed.length > 1 ? "critical" : "warning",
        kind: "branch-regression",
        scope: row.scope,
        branch: worst?.branch,
        title: `${row.scope} regressed on ${plural(regressed.length, "branch")}`,
        detail: worst
          ? `Worst is ${worst.branch} at ${worst.latestPassRate.toFixed(0)}% vs ${row.baselinePassRate?.toFixed(0)}% on ${baseline}. Affected: ${listNames(regressed.map((cell) => cell.branch))}.`
          : "",
      });
    });
  branches
    .filter((column) => !column.isBaseline && column.scopesRegressed >= 2)
    .slice(0, 3)
    .forEach((column) =>
      insights.push({
        id: `blast:${column.branch}`,
        severity: "critical",
        kind: "branch-regression",
        branch: column.branch,
        title: `${column.branch} drags down ${plural(column.scopesRegressed, noun)}`,
        detail: `Broad blast radius: this branch scores at least ${REGRESSION_POINTS} points below ${baseline} on ${plural(column.scopesRegressed, noun)}${column.actors.length ? `. Triggered by ${listNames(column.actors, 2)}` : ""}.`,
      }),
    );
  if (baseline)
    allCells
      .filter((cell) => cell.branch === baseline && cell.runs.length >= 3)
      .map((cell) => ({
        cell,
        drop: cell.runs[0].summary.passRatePct - cell.latestPassRate,
      }))
      .filter(({ drop }) => drop >= REGRESSION_POINTS * 2)
      .sort((a, b) => b.drop - a.drop)
      .slice(0, 2)
      .forEach(({ cell, drop }) =>
        insights.push({
          id: `drift:${cell.scope}`,
          severity: "warning",
          kind: "baseline-drift",
          scope: cell.scope,
          branch: baseline,
          title: `${cell.scope} is sliding on ${baseline}`,
          detail: `Down ${drop.toFixed(0)} points over ${plural(cell.runs.length, "run")} in this window (${cell.runs[0].summary.passRatePct.toFixed(0)}% → ${cell.latestPassRate.toFixed(0)}%). Something already merged is hurting it.`,
        }),
      );
  branches
    .filter((column) => !column.isBaseline && column.scopesImproved > 0)
    .sort((a, b) => b.scopesImproved - a.scopesImproved)
    .slice(0, 2)
    .forEach((column) =>
      insights.push({
        id: `improve:${column.branch}`,
        severity: "good",
        kind: "branch-fix",
        branch: column.branch,
        title: `${column.branch} improves ${plural(column.scopesImproved, noun)}`,
        detail: `Scores at least ${REGRESSION_POINTS} points above ${baseline}. Worth reviewing and merging.`,
      }),
    );
  environmentGaps(allCells, baseline)
    .slice(0, 3)
    .forEach((gap) =>
      insights.push({
        id: `environment:${gap.scope}`,
        severity:
          gap.spread >= ENVIRONMENT_GAP_POINTS * 2.5 ? "critical" : "warning",
        kind: "environment-gap",
        scope: gap.scope,
        branch: gap.branch,
        title: `${gap.scope} scores ${gap.worst.passRate.toFixed(0)}% on ${gap.worst.context} but ${gap.best.passRate.toFixed(0)}% on ${gap.best.context}`,
        detail: `Same branch (${gap.branch}), latest run in each of ${plural(gap.contexts, "stage/target")}. The ${noun} behaves differently by environment, not by code. Pick a Stage and Target to compare branches like-for-like.`,
      }),
    );
  return { scopes, branches, cells, insights: rankInsights(insights) };
}
type EnvironmentGap = {
  scope: string;
  branch: string;
  spread: number;
  contexts: number;
  best: { context: string; passRate: number };
  worst: { context: string; passRate: number };
};
function environmentGaps(
  cells: ScopeBranchCell[],
  baseline: string | null,
): EnvironmentGap[] {
  const byScope = new Map<string, EnvironmentGap>();
  cells.forEach((cell) => {
    const latestByContext = new Map<string, EvalRun>();
    cell.runs.forEach((run) => latestByContext.set(runContext(run), run));
    if (latestByContext.size < 2) return;
    const ranked = [...latestByContext.entries()]
      .map(([context, run]) => ({ context, passRate: run.summary.passRatePct }))
      .sort((a, b) => a.passRate - b.passRate);
    const worst = ranked[0],
      best = ranked[ranked.length - 1],
      spread = best.passRate - worst.passRate;
    if (spread < ENVIRONMENT_GAP_POINTS) return;
    const gap = {
      scope: cell.scope,
      branch: cell.branch,
      spread,
      contexts: ranked.length,
      best,
      worst,
    };
    const current = byScope.get(cell.scope);
    const preferBaseline =
      cell.branch === baseline && current?.branch !== baseline;
    if (
      !current ||
      preferBaseline ||
      (current.branch !== baseline && spread > current.spread)
    )
      byScope.set(cell.scope, gap);
  });
  return [...byScope.values()].sort((a, b) => b.spread - a.spread);
}
export type Observation = {
  runId: string;
  startedAt: string;
  context: string;
  gitSha?: string;
  outcome: Outcome;
  score: number;
};
export type TestBranchCell = {
  testKey: string;
  branch: string;
  observations: Observation[];
  latest: Observation;
  passes: number;
  failures: number;
  flips: number;
  state: CellState;
};
export type TestRow = {
  testKey: string;
  label: string;
  group: string;
  failingBranches: number;
  branchesWithData: number;
  regressions: number;
  fixes: number;
  flaky: boolean;
  failsOnBaseline: boolean;
  bottleneck: boolean;
  branchSpecific: string | null;
  environmentSplit: {
    branch: string;
    failing: string[];
    passing: string[];
  } | null;
  failureCount: number;
  history: Observation[];
};
export type BranchTestColumn = {
  branch: string;
  isBaseline: boolean;
  regressions: number;
  fixes: number;
  passRate: number;
  testsRun: number;
  runsLoaded: number;
};
export type TestMatrix = {
  tests: TestRow[];
  branches: BranchTestColumn[];
  cells: Map<string, TestBranchCell>;
  insights: Insight[];
  totalFailures: number;
};
export function caseTestKey(item: EvalCase): string {
  return `${item.suite}::${item.testName || item.caseId}`;
}
function countFlips(observations: Observation[]) {
  const latestByContext = new Map<string, boolean>();
  let flips = 0;
  observations.forEach((observation) => {
    const failing = isFailing(observation.outcome);
    const before = latestByContext.get(observation.context);
    if (before !== undefined && before !== failing) flips += 1;
    latestByContext.set(observation.context, failing);
  });
  return flips;
}
export function buildTestMatrix(
  runs: EvalRun[],
  casesByRun: Record<string, EvalCase[] | undefined>,
  baseline: string | null,
): TestMatrix {
  const sortedRuns = [...runs].sort(byStartedAt),
    raw = new Map<string, Observation[]>(),
    labels = new Map<string, { label: string; group: string }>(),
    runsLoaded = new Map<string, number>();
  sortedRuns.forEach((run) => {
    const items = casesByRun[run.runId];
    if (!items) return;
    const branch = runBranch(run);
    runsLoaded.set(branch, (runsLoaded.get(branch) ?? 0) + 1);
    items.forEach((item) => {
      const testKey = caseTestKey(item);
      if (!labels.has(testKey))
        labels.set(testKey, {
          label: item.testName || item.caseId,
          group: item.suite,
        });
      const key = cellKey(testKey, branch);
      raw.set(key, [
        ...(raw.get(key) ?? []),
        {
          runId: run.runId,
          startedAt: run.startedAt,
          context: runContext(run),
          gitSha: run.gitSha,
          outcome: caseOutcome(item.verdict),
          score: item.score,
        },
      ]);
    });
  });
  const cells = new Map<string, TestBranchCell>();
  raw.forEach((observations, key) => {
    const [testKey, branch] = key.split("\u0000"),
      latest = observations[observations.length - 1];
    cells.set(key, {
      testKey,
      branch,
      observations,
      latest,
      passes: observations.filter((o) => o.outcome === "pass").length,
      failures: observations.filter((o) => isFailing(o.outcome)).length,
      flips: countFlips(observations),
      state: isFailing(latest.outcome) ? "fail" : "pass",
    });
  });
  cells.forEach((cell) => {
    const base =
      baseline && cell.branch !== baseline
        ? cells.get(cellKey(cell.testKey, baseline))
        : undefined;
    const comparable = base !== undefined && base.flips < 2;
    const failing = isFailing(cell.latest.outcome);
    const reference = base
      ? (base.observations
          .filter((observation) => observation.context === cell.latest.context)
          .at(-1) ?? base.latest)
      : undefined;
    const baseFailing = reference ? isFailing(reference.outcome) : false;
    if (cell.flips >= 2) cell.state = "flaky";
    else if (comparable && failing && !baseFailing) cell.state = "regression";
    else if (comparable && !failing && baseFailing) cell.state = "fixed";
  });
  const branchNames = Array.from(runsLoaded.keys()),
    allCells = [...cells.values()];
  const tests: TestRow[] = Array.from(labels.entries()).map(
    ([testKey, { label, group }]) => {
      const row = allCells.filter((cell) => cell.testKey === testKey),
        failingCells = row.filter((cell) => isFailing(cell.latest.outcome)),
        baseCell = baseline ? cells.get(cellKey(testKey, baseline)) : undefined,
        failsOnBaseline = Boolean(
          baseCell && isFailing(baseCell.latest.outcome),
        ),
        regressions = row.filter((cell) => cell.state === "regression"),
        history = row
          .flatMap((cell) => cell.observations)
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
        split = environmentSplit(row, baseline);
      return {
        testKey,
        label,
        group,
        failingBranches: failingCells.length,
        branchesWithData: row.length,
        regressions: regressions.length,
        fixes: row.filter((cell) => cell.state === "fixed").length,
        flaky: row.some((cell) => cell.flips >= 2),
        failsOnBaseline,
        bottleneck:
          !split &&
          row.length >= 2 &&
          failingCells.length >= Math.max(2, Math.ceil(row.length / 2)) &&
          (failsOnBaseline || !baseCell),
        branchSpecific:
          regressions.length === 1 && failingCells.length === 1
            ? regressions[0].branch
            : null,
        environmentSplit: split,
        failureCount: row.reduce((total, cell) => total + cell.failures, 0),
        history,
      };
    },
  );
  tests.sort(
    (a, b) =>
      Number(b.bottleneck) - Number(a.bottleneck) ||
      b.failingBranches - a.failingBranches ||
      b.regressions - a.regressions ||
      b.failureCount - a.failureCount ||
      a.label.localeCompare(b.label),
  );
  const branches: BranchTestColumn[] = branchNames.map((branch) => {
    const column = allCells.filter((cell) => cell.branch === branch),
      passing = column.filter((cell) => !isFailing(cell.latest.outcome));
    return {
      branch,
      isBaseline: branch === baseline,
      regressions: column.filter((cell) => cell.state === "regression").length,
      fixes: column.filter((cell) => cell.state === "fixed").length,
      passRate: column.length ? (passing.length / column.length) * 100 : 0,
      testsRun: column.length,
      runsLoaded: runsLoaded.get(branch) ?? 0,
    };
  });
  branches.sort(
    (a, b) =>
      Number(b.isBaseline) - Number(a.isBaseline) ||
      b.regressions - a.regressions ||
      a.passRate - b.passRate ||
      a.branch.localeCompare(b.branch),
  );
  const totalFailures = tests.reduce(
    (total, row) => total + row.failureCount,
    0,
  );
  return {
    tests,
    branches,
    cells,
    totalFailures,
    insights: rankInsights(
      testInsights(
        tests,
        branches,
        cells,
        baseline,
        totalFailures,
        labels.size,
      ),
    ),
  };
}
function environmentSplit(
  row: TestBranchCell[],
  baseline: string | null,
): TestRow["environmentSplit"] {
  const splits = row.flatMap((cell) => {
    const byContext = new Map<string, Observation[]>();
    cell.observations.forEach((observation) =>
      byContext.set(observation.context, [
        ...(byContext.get(observation.context) ?? []),
        observation,
      ]),
    );
    const failing: string[] = [],
      passing: string[] = [];
    let failingResults = 0;
    byContext.forEach((observations, context) => {
      if (observations.every((observation) => isFailing(observation.outcome))) {
        failing.push(context);
        failingResults += observations.length;
      } else if (
        observations.every((observation) => observation.outcome === "pass")
      )
        passing.push(context);
    });
    return failing.length && passing.length && failingResults >= 2
      ? [
          {
            branch: cell.branch,
            failing: failing.sort(),
            passing: passing.sort(),
            weight: cell.observations.length,
          },
        ]
      : [];
  });
  const chosen =
    splits.find((split) => split.branch === baseline) ??
    [...splits].sort((a, b) => b.weight - a.weight)[0];
  return chosen
    ? {
        branch: chosen.branch,
        failing: chosen.failing,
        passing: chosen.passing,
      }
    : null;
}
function testInsights(
  tests: TestRow[],
  branches: BranchTestColumn[],
  cells: Map<string, TestBranchCell>,
  baseline: string | null,
  totalFailures: number,
  testCount: number,
): Insight[] {
  const insights: Insight[] = [];
  tests
    .filter((row) => row.bottleneck)
    .slice(0, 3)
    .forEach((row) =>
      insights.push({
        id: `bottleneck:${row.testKey}`,
        severity: "critical",
        kind: "bottleneck",
        testKey: row.testKey,
        title: `${row.label} fails on ${row.failingBranches} of ${row.branchesWithData} branches`,
        detail: row.failsOnBaseline
          ? `Fails on ${baseline} too, so this is a bottleneck for the skill itself. Fixing it lifts every branch at once.`
          : "Fails across most branches. Treat it as a shared bottleneck, not a branch problem.",
      }),
    );
  branches
    .filter((column) => !column.isBaseline && column.regressions > 0)
    .slice(0, 3)
    .forEach((column) => {
      const broken = tests.filter(
          (row) =>
            cells.get(cellKey(row.testKey, column.branch))?.state ===
            "regression",
        ),
        onlyHere = broken.filter((row) => row.branchSpecific === column.branch);
      insights.push({
        id: `branch-regression:${column.branch}`,
        severity: column.regressions > 1 ? "critical" : "warning",
        kind: "branch-regression",
        branch: column.branch,
        title: `${column.branch} breaks ${plural(column.regressions, "test")} that pass on ${baseline}`,
        detail: onlyHere.length
          ? `Only this branch fails ${listNames(onlyHere.map((row) => row.label))}. Start the investigation in this branch's diff.`
          : `Broken here: ${listNames(broken.map((row) => row.label))}. Other branches fail these too.`,
      });
    });
  branches
    .filter((column) => !column.isBaseline && column.fixes > 0)
    .sort((a, b) => b.fixes - a.fixes)
    .slice(0, 2)
    .forEach((column) =>
      insights.push({
        id: `branch-fix:${column.branch}`,
        severity: "good",
        kind: "branch-fix",
        branch: column.branch,
        title: `${column.branch} fixes ${plural(column.fixes, "test")} failing on ${baseline}`,
        detail:
          "Passes where the baseline fails. Likely a fix worth merging or cherry-picking.",
      }),
    );
  const flaky = tests.filter((row) => row.flaky);
  if (flaky.length)
    insights.push({
      id: "flaky",
      severity: "warning",
      kind: "flaky",
      testKey: flaky[0].testKey,
      title: `${plural(flaky.length, "test")} ${flaky.length === 1 ? "flips" : "flip"} between pass and fail on the same branch`,
      detail: `${listNames(flaky.map((row) => row.label))}. Don't blame a branch for these until they are stable.`,
    });
  if (totalFailures >= 5) {
    const ranked = [...tests].sort((a, b) => b.failureCount - a.failureCount);
    let covered = 0,
      count = 0;
    while (count < ranked.length && covered < totalFailures * 0.6) {
      covered += ranked[count].failureCount;
      count += 1;
    }
    if (count > 0 && count <= Math.max(1, Math.floor(testCount / 4)))
      insights.push({
        id: "concentration",
        severity: "info",
        kind: "concentration",
        testKey: ranked[0].testKey,
        title: `${plural(count, "test")} ${count === 1 ? "accounts" : "account"} for ${Math.round((covered / totalFailures) * 100)}% of all failures`,
        detail: `Failures are concentrated: ${listNames(ranked.slice(0, count).map((row) => row.label))}. That is the shortest path to green.`,
      });
  }
  const splitGroups = new Map<string, TestRow[]>();
  tests
    .filter((row) => row.environmentSplit)
    .forEach((row) => {
      const key = row.environmentSplit!.failing.join(", ");
      splitGroups.set(key, [...(splitGroups.get(key) ?? []), row]);
    });
  [...splitGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .forEach(([failingOn, rows]) => {
      const example = rows[0].environmentSplit!;
      insights.push({
        id: `environment:${failingOn}`,
        severity: rows.length > 1 ? "critical" : "warning",
        kind: "environment-gap",
        testKey: rows[0].testKey,
        branch: example.branch,
        title: `${plural(rows.length, "test")} fail${rows.length === 1 ? "s" : ""} only on ${failingOn}`,
        detail: `${listNames(rows.map((row) => row.label))}. ${rows.length === 1 ? "Passes" : "Pass"} on ${listNames(example.passing, 2)} on the same branch (${example.branch}). Look at that environment's data or config before changing the skill.`,
      });
    });
  const fullCoverage = Math.max(
    0,
    ...branches.map((column) => column.testsRun),
  );
  branches
    .filter(
      (column) => column.testsRun > 0 && column.testsRun < fullCoverage * 0.6,
    )
    .slice(0, 1)
    .forEach((column) =>
      insights.push({
        id: `coverage:${column.branch}`,
        severity: "info",
        kind: "coverage",
        branch: column.branch,
        title: `${column.branch} only ran ${column.testsRun} of ${fullCoverage} tests`,
        detail:
          "Its pass rate is not directly comparable. Check the selected mode or metrics.",
      }),
    );
  return insights;
}
const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  good: 2,
  info: 3,
};
function rankInsights(insights: Insight[]) {
  return [...insights].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
export function runsForCaseLoad(
  scopeRuns: EvalRun[],
  perBranch: number,
  total: number,
): EvalRun[] {
  const byBranch = new Map<string, EvalRun[]>();
  [...scopeRuns]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .forEach((run) => {
      const branch = runBranch(run),
        list = byBranch.get(branch) ?? [];
      if (list.length < perBranch) byBranch.set(branch, [...list, run]);
    });
  const queues = [...byBranch.values()],
    picked: EvalRun[] = [];
  for (let depth = 0; picked.length < total && depth < perBranch; depth += 1)
    queues.forEach((queue) => {
      if (picked.length < total && queue[depth]) picked.push(queue[depth]);
    });
  return picked;
}
