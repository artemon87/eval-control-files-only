import type { UnitApiCase } from "./eval-api";
import type { HistoryCohort, HistoryRun } from "./unit-history-types";

export function comparableTrendRuns(
  current: HistoryRun,
  reference: HistoryRun | undefined,
  cohorts: HistoryCohort[],
): boolean {
  return Boolean(
    reference &&
      current.runId !== reference.runId &&
      current.qualityMeasured === true &&
      reference.qualityMeasured === true &&
      current.total === reference.total &&
      current.caseSetKey &&
      current.caseSetKey === reference.caseSetKey &&
      current.cohortKey &&
      current.cohortKey === reference.cohortKey &&
      cohorts.find((cohort) => cohort.key === current.cohortKey)
        ?.configurationComplete,
  );
}

export function trendComparisonBlockers(
  current: HistoryRun,
  reference: HistoryRun | undefined,
  cohorts: HistoryCohort[],
): string[] {
  if (!reference)
    return [
      "No reference execution selected or no earlier compatible run in this branch and time window.",
    ];
  const reasons: string[] = [];
  if (current.runId === reference.runId)
    reasons.push("Choose a different reference execution.");
  if (current.qualityMeasured !== true || reference.qualityMeasured !== true)
    reasons.push("One execution has no complete quality measurement.");
  if (
    current.total !== reference.total ||
    !current.caseSetKey ||
    current.caseSetKey !== reference.caseSetKey
  )
    reasons.push("Recorded test sets differ or their identity is missing.");
  if (!current.cohortKey || current.cohortKey !== reference.cohortKey)
    reasons.push(
      "Recorded evaluation settings differ or are missing (including BSA version, runtime, metrics or thresholds).",
    );
  if (
    !cohorts.find((cohort) => cohort.key === current.cohortKey)
      ?.configurationComplete ||
    !cohorts.find((cohort) => cohort.key === reference.cohortKey)
      ?.configurationComplete
  )
    reasons.push(
      "Configuration metadata is incomplete; comparison equivalence cannot be established.",
    );
  return reasons;
}

export function previousTrendRun(
  current: HistoryRun,
  runs: HistoryRun[],
  cohorts: HistoryCohort[],
): HistoryRun | undefined {
  if (current.branchLabel === "Branch not recorded") return undefined;
  const index = runs.findIndex((run) => run.runId === current.runId);
  if (index < 0) return undefined;
  // The API preserves repository ordering when timestamps tie. Never infer Git ancestry.
  return runs
    .slice(index + 1)
    .find(
      (run) =>
        run.branchKey === current.branchKey &&
        comparableTrendRuns(current, run, cohorts),
    );
}

export function trendCaseKey(record: UnitApiCase): string {
  return JSON.stringify([
    record.test_name?.trim() || record.case_id?.trim(),
    record.test_type?.trim() || null,
  ]);
}

export function recordedCaseState(record: UnitApiCase | undefined): string {
  if (!record) return "Unavailable";
  return (
    (
      {
        passed: "Passed",
        failed: "Failed",
        error: "Blocked / error",
        blocked: "Blocked / error",
        pending: "Pending",
        skipped: "Skipped",
        xpassed: "XPASS",
      } as Record<string, string>
    )[record.verdict] ?? "Unknown"
  );
}

export interface TrendCaseRow {
  key: string;
  label: string;
  testType: string;
  current: UnitApiCase[];
  reference: UnitApiCase[];
  change: "Recovered" | "New failure" | "Unchanged" | "Not compared";
}

function groupCases(records: UnitApiCase[]): Map<string, UnitApiCase[]> {
  const result = new Map<string, UnitApiCase[]>();
  for (const record of records) {
    const key = trendCaseKey(record);
    const group = result.get(key) ?? [];
    group.push(record);
    result.set(key, group);
  }
  return result;
}

function definition(record: UnitApiCase): string {
  return JSON.stringify([
    Object.keys(record.scores ?? {}).sort(),
    Object.entries(record.thresholds ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  ]);
}

export function completeTrendCaseComparison(
  current: UnitApiCase[],
  reference: UnitApiCase[],
  run: HistoryRun,
  baseline: HistoryRun,
): boolean {
  const valid = (records: UnitApiCase[], metadata: HistoryRun) =>
    records.length === metadata.total &&
    groupCases(records).size === records.length &&
    records.every(
      (record) =>
        record.run_id === metadata.runId &&
        Boolean(record.test_name?.trim() || record.case_id?.trim()) &&
        ["passed", "failed"].includes(record.verdict),
    ) &&
    records.filter((record) => record.verdict === "passed").length ===
      metadata.passed;
  if (
    current.length !== reference.length ||
    !valid(current, run) ||
    !valid(reference, baseline)
  )
    return false;
  const earlier = groupCases(reference);
  return current.every((record) => {
    const match = earlier.get(trendCaseKey(record));
    return match?.length === 1 && definition(record) === definition(match[0]);
  });
}

export function trendCaseRows(
  current: UnitApiCase[],
  reference: UnitApiCase[],
  comparable: boolean,
): TrendCaseRow[] {
  const now = groupCases(current),
    before = groupCases(reference);
  return [...now.entries()]
    .map(([key, records]) => {
      const previous = before.get(key) ?? [];
      let change: TrendCaseRow["change"] = "Not compared";
      if (comparable && records.length === 1 && previous.length === 1) {
        change =
          previous[0].verdict === records[0].verdict
            ? "Unchanged"
            : records[0].verdict === "passed"
              ? "Recovered"
              : "New failure";
      }
      return {
        key,
        label: records[0].test_name?.trim() || records[0].case_id,
        testType: records[0].test_type,
        current: records,
        reference: previous,
        change,
      };
    })
    .sort(
      (a, b) =>
        Number(b.change === "New failure") -
          Number(a.change === "New failure") ||
        Number(b.change === "Recovered") - Number(a.change === "Recovered") ||
        a.label.localeCompare(b.label),
    );
}
