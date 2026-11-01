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

export type ScopeBranchCell = {
  scope: string;
  branch: string;
  runs: InsightsRun[];
  latest: InsightsRun;
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

export type InsightsRun = {
  runId: string;
  evalType: "unit" | "e2e";
  target: string;
  stage: string;
  context: string;
  startedAt: string;
  verdict: string;
  gitSha?: string;
  summary: { total: number; passRatePct: number };
};

export function cellKey(row: string, branch: string) {
  return `${row}\u0000${branch}`;
}
export function runContext(run: InsightsRun) {
  return run.context;
}

export type InsightsQuery = {
  evalType: "unit" | "e2e";
  range: "7d" | "30d" | "90d";
  windowEnd?: string;
  repository: string;
  category: string | null;
  stage: string | null;
  targetEnvironment: string;
  scope: string | null;
  baseline: string | null;
};
export type InsightsResponse = {
  window: { startedFrom: string; startedBefore: string };
  coverage: "complete";
  rulesVersion: string;
  repositories: string[];
  categories: string[];
  scopeOptions: string[];
  stageOptions: string[];
  targetOptions: string[];
  branchNames: string[];
  activeCategory: string;
  activeStage: string;
  activeTarget: string;
  activeScope: string | null;
  baseline: string | null;
  mixedStages: number;
  mixedTargets: number;
  regressionPoints: number;
  counts: {
    runCount: number;
    scopeCount: number;
    branchCount: number;
    regressedCells: number;
    systemicScopes: number;
    caseRunCount: number;
    testsTracked: number;
    bottleneckTests: number;
    branchRegressions: number;
    flakyTests: number;
  };
  landscape: Landscape;
  matrix: TestMatrix | null;
};
export type InsightsWireResponse = Omit<
  InsightsResponse,
  "landscape" | "matrix"
> & {
  landscape: Omit<Landscape, "cells"> & {
    cells: Record<string, ScopeBranchCell>;
  };
  matrix:
    | (Omit<TestMatrix, "cells"> & { cells: Record<string, TestBranchCell> })
    | null;
};
