import type { Verdict } from "./eval-types";

export interface E2EHistoryPoint {
  runId: string;
  batchId: string;
  startedAt: string;
  stage: string;
  target: string;
  passRatePct: number;
  meanScore: number;
  totalCases: number;
  durationMs: number;
  verdict: Verdict;
}

export interface UnitHistoryPoint {
  runId: string;
  batchId?: string;
  startedAt: string;
  skillId: string;
  environment: string;
  passRatePct: number;
  meanScore: number;
  generalQuality: number;
  toolUseQuality: number;
  totalCases: number;
  durationMs: number;
  verdict: Verdict;
}

export const e2eHistory: E2EHistoryPoint[] = [
  { runId: "e2e-a151cf220e", batchId: "gh-44182", startedAt: "2026-08-01T06:00:00Z", stage: "1-dev-staging", target: "us-east4-dev-staging", passRatePct: 75, meanScore: 3.74, totalCases: 8, durationMs: 331000, verdict: "failed" },
  { runId: "e2e-35ed781af2", batchId: "gh-44182", startedAt: "2026-08-01T06:00:05Z", stage: "1-dev-staging", target: "europe-west1-dev-staging", passRatePct: 87.5, meanScore: 4.01, totalCases: 8, durationMs: 346000, verdict: "failed" },
  { runId: "e2e-442f77a309", batchId: "gh-44401", startedAt: "2026-08-03T06:00:00Z", stage: "1-dev-staging", target: "us-east4-dev-staging", passRatePct: 87.5, meanScore: 4.05, totalCases: 8, durationMs: 319000, verdict: "failed" },
  { runId: "e2e-0df4829a21", batchId: "gh-44401", startedAt: "2026-08-03T06:00:03Z", stage: "1-dev-staging", target: "europe-west1-dev-staging", passRatePct: 100, meanScore: 4.42, totalCases: 8, durationMs: 337000, verdict: "passed" },
  { runId: "e2e-83ab5dc192", batchId: "gh-44673", startedAt: "2026-08-05T06:00:00Z", stage: "1-dev-staging", target: "us-east4-dev-staging", passRatePct: 100, meanScore: 4.1, totalCases: 8, durationMs: 305000, verdict: "passed" },
  { runId: "e2e-442a29bb7c", batchId: "gh-44673", startedAt: "2026-08-05T06:00:04Z", stage: "1-dev-staging", target: "europe-west1-dev-staging", passRatePct: 100, meanScore: 4.55, totalCases: 8, durationMs: 321000, verdict: "passed" },
  { runId: "e2e-97a0f7b810", batchId: "gh-44918", startedAt: "2026-08-07T00:00:44Z", stage: "1-dev-staging", target: "us-east4-dev-staging", passRatePct: 87.5, meanScore: 4.25, totalCases: 8, durationMs: 328000, verdict: "failed" },
  { runId: "e2e-fd8851b63a", batchId: "gh-44918", startedAt: "2026-08-07T00:00:49Z", stage: "1-dev-staging", target: "europe-west1-dev-staging", passRatePct: 100, meanScore: 4.61, totalCases: 8, durationMs: 335000, verdict: "passed" },
  { runId: "e2e-4f3901ab71", batchId: "gh-44304", startedAt: "2026-08-02T07:00:00Z", stage: "2-staging", target: "us-east4-staging", passRatePct: 83.3, meanScore: 3.92, totalCases: 24, durationMs: 498000, verdict: "failed" },
  { runId: "e2e-c91e42a703", batchId: "gh-44304", startedAt: "2026-08-02T07:00:07Z", stage: "2-staging", target: "europe-west1-staging", passRatePct: 87.5, meanScore: 4.08, totalCases: 24, durationMs: 512000, verdict: "failed" },
  { runId: "e2e-113d0ac229", batchId: "gh-44617", startedAt: "2026-08-04T07:00:00Z", stage: "2-staging", target: "us-east4-staging", passRatePct: 91.7, meanScore: 4.22, totalCases: 24, durationMs: 476000, verdict: "passed" },
  { runId: "e2e-f2018de912", batchId: "gh-44617", startedAt: "2026-08-04T07:00:04Z", stage: "2-staging", target: "europe-west1-staging", passRatePct: 95.8, meanScore: 4.33, totalCases: 24, durationMs: 489000, verdict: "passed" },
  { runId: "e2e-4cb1960d72", batchId: "gh-44882", startedAt: "2026-08-06T21:18:31Z", stage: "2-staging", target: "us-east4-staging", passRatePct: 95.8, meanScore: 4.38, totalCases: 24, durationMs: 462000, verdict: "passed" },
  { runId: "e2e-1177ee2a06", batchId: "gh-44882", startedAt: "2026-08-06T21:18:36Z", stage: "2-staging", target: "europe-west1-staging", passRatePct: 100, meanScore: 4.49, totalCases: 24, durationMs: 471000, verdict: "passed" },
  { runId: "e2e-6ca2aa81e1", batchId: "gh-44210", startedAt: "2026-08-01T08:00:00Z", stage: "3-prod", target: "us-east4-prod", passRatePct: 96.2, meanScore: 4.51, totalCases: 26, durationMs: 521000, verdict: "passed" },
  { runId: "e2e-a77c811301", batchId: "gh-44711", startedAt: "2026-08-05T08:00:00Z", stage: "3-prod", target: "us-east4-prod", passRatePct: 100, meanScore: 4.63, totalCases: 26, durationMs: 507000, verdict: "passed" },
];

export const unitHistory: UnitHistoryPoint[] = [
  { runId: "unit-04f291b8", batchId: "ui-8121", startedAt: "2026-08-01T17:00:00Z", skillId: "feedback-skill", environment: "staging", passRatePct: 66.7, meanScore: 3.5, generalQuality: 3.1, toolUseQuality: 4.7, totalCases: 3, durationMs: 47000, verdict: "failed" },
  { runId: "unit-7a9b311c", batchId: "ui-8169", startedAt: "2026-08-03T17:00:00Z", skillId: "feedback-skill", environment: "staging", passRatePct: 66.7, meanScore: 3.9, generalQuality: 3.6, toolUseQuality: 4.8, totalCases: 3, durationMs: 45000, verdict: "failed" },
  { runId: "unit-e3289dd092", batchId: "cli-2201", startedAt: "2026-08-04T14:38:27Z", skillId: "feedback-skill", environment: "dev", passRatePct: 100, meanScore: 4.66, generalQuality: 4.5, toolUseQuality: 5, totalCases: 3, durationMs: 49000, verdict: "passed" },
  { runId: "unit-1f8ad633c5", batchId: "ci-9918", startedAt: "2026-08-06T19:03:44Z", skillId: "feedback-skill", environment: "staging", passRatePct: 66.7, meanScore: 3.67, generalQuality: 3.2, toolUseQuality: 5, totalCases: 3, durationMs: 45000, verdict: "failed" },
  { runId: "unit-fc82d1a640", batchId: "ci-9972", startedAt: "2026-08-06T22:42:18Z", skillId: "feedback-skill", environment: "staging", passRatePct: 100, meanScore: 5, generalQuality: 5, toolUseQuality: 5, totalCases: 3, durationMs: 46000, verdict: "passed" },
  { runId: "unit-28c3a52d", batchId: "ui-8121", startedAt: "2026-08-01T17:00:02Z", skillId: "time-off-balance-skill", environment: "staging", passRatePct: 80, meanScore: 3.84, generalQuality: 3.7, toolUseQuality: 4.6, totalCases: 15, durationMs: 91000, verdict: "failed" },
  { runId: "unit-93f5e22a", batchId: "ui-8169", startedAt: "2026-08-03T17:00:03Z", skillId: "time-off-balance-skill", environment: "staging", passRatePct: 86.7, meanScore: 4.02, generalQuality: 3.9, toolUseQuality: 4.7, totalCases: 15, durationMs: 87000, verdict: "failed" },
  { runId: "unit-f41ea991", batchId: "ci-9972", startedAt: "2026-08-06T22:42:20Z", skillId: "time-off-balance-skill", environment: "staging", passRatePct: 100, meanScore: 4.72, generalQuality: 4.6, toolUseQuality: 5, totalCases: 15, durationMs: 84000, verdict: "passed" },
  { runId: "unit-993aa732", batchId: "ui-8134", startedAt: "2026-08-02T18:00:00Z", skillId: "create-requisition-skill", environment: "staging", passRatePct: 87.5, meanScore: 4.01, generalQuality: 3.9, toolUseQuality: 4.5, totalCases: 24, durationMs: 112000, verdict: "failed" },
  { runId: "unit-5d71cc81", batchId: "ui-8180", startedAt: "2026-08-04T18:00:00Z", skillId: "create-requisition-skill", environment: "staging", passRatePct: 95.8, meanScore: 4.38, generalQuality: 4.3, toolUseQuality: 4.8, totalCases: 24, durationMs: 104000, verdict: "passed" },
  { runId: "unit-c64a203a", batchId: "ci-9972", startedAt: "2026-08-06T22:42:22Z", skillId: "create-requisition-skill", environment: "staging", passRatePct: 100, meanScore: 4.64, generalQuality: 4.5, toolUseQuality: 5, totalCases: 24, durationMs: 99000, verdict: "passed" },
  { runId: "unit-a0e33741", batchId: "ci-9810", startedAt: "2026-08-01T20:00:00Z", skillId: "verify-license-skill", environment: "staging", passRatePct: 89.7, meanScore: 3.91, generalQuality: 3.8, toolUseQuality: 4.6, totalCases: 39, durationMs: 128000, verdict: "failed" },
  { runId: "unit-e11df551", batchId: "ci-9864", startedAt: "2026-08-03T20:00:00Z", skillId: "verify-license-skill", environment: "staging", passRatePct: 94.9, meanScore: 4.18, generalQuality: 4.1, toolUseQuality: 4.8, totalCases: 39, durationMs: 121000, verdict: "passed" },
  { runId: "unit-88cc1072", batchId: "ci-9918", startedAt: "2026-08-06T19:03:48Z", skillId: "verify-license-skill", environment: "staging", passRatePct: 94.9, meanScore: 4.16, generalQuality: 4.05, toolUseQuality: 4.9, totalCases: 39, durationMs: 119000, verdict: "passed" },
];
