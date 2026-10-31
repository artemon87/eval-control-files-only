import type { FixedTimeWindow } from "./time-window";

export interface UnitHistoryScope {
  scopeKey: string;
  skill: string;
  githubRepository: string | null;
  stage: string;
  targetEnvironment: string | null;
  environment: string;
}

export interface HistoryRun {
  runId: string;
  branchKey: string;
  branchLabel: string;
  gitSha: string | null;
  actor: string | null;
  trigger: string | null;
  startedAt: string;
  executionStatus: string;
  verdict: string;
  skillVersion: string | null;
  total: number | null;
  passed: number | null;
  passRatePct: number | null;
  durationMs: number | null;
  caseCount: number;
  casesComplete: boolean;
  cohortKey: string | null;
  contextMatch: boolean;
}

export interface HistoryCommit {
  key: string;
  sha: string | null;
  firstAt: string;
  lastAt: string;
  runIds: string[];
  lowPassRate: number | null;
  highPassRate: number | null;
}

export interface HistoryBranch {
  key: string;
  label: string;
  runCount: number;
  latestRunId: string;
  latestActor: string | null;
  latestAt: string;
  direction:
    "improved" | "declined" | "unchanged" | "insufficient" | "context_changed";
  firstPassRate: number | null;
  latestPassRate: number | null;
  firstTotal: number | null;
  latestTotal: number | null;
  latestContextMatch: boolean;
  coverageExpected: number | null;
  coverageActual: number | null;
  fewerCases: boolean;
  inconsistentLatest: boolean;
  commits: HistoryCommit[];
}

export type HistoryCaseState =
  | "passed"
  | "failed"
  | "blocked"
  | "xpassed"
  | "skipped"
  | "pending"
  | "not_run"
  | "unavailable";

export interface HistoryCaseCell {
  branchKey: string;
  executions: number;
  failed: number;
  passed: number;
  blocked: number;
  xpassed: number;
  skipped: number;
  pending: number;
  latestState: HistoryCaseState;
  latestRunId: string;
  latestContextMatch: boolean;
  latestAt: string;
}

export interface HistoryCase {
  key: string;
  label: string;
  testType: string | null;
  executions: number;
  failed: number;
  affectedBranches: number;
  firstFailedAt: string | null;
  lastFailedAt: string | null;
  inconsistentUpdates: number;
  cells: HistoryCaseCell[];
}

export interface HistoryCohort {
  key: string;
  label: string;
  runCount: number;
  branchCount: number;
  caseCount: number;
  configurationComplete: boolean;
  details: string[];
}

export interface UnitHistoryInsights {
  scope: UnitHistoryScope;
  startedFrom: string;
  startedBefore: string;
  cohorts: HistoryCohort[];
  selectedCohortKey: string | null;
  runs: HistoryRun[];
  branches: HistoryBranch[];
  cases: HistoryCase[];
  signals: {
    recurringCaseKey: string | null;
    inconsistentUpdates: number;
    inconsistentCaseKeys: string[];
    coverageGapBranchKeys: string[];
    excludedRuns: number;
    incompleteCaseRuns: number;
    operationalRuns: number;
  };
}

export interface UnitHistoryQuery extends FixedTimeWindow {
  scopeKey: string;
  cohortKey?: string;
}

export interface UnitHistoryFocus {
  skillId?: string;
  stage?: string;
  targetEnvironment?: string;
  environment?: string;
}
