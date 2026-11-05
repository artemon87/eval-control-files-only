import type { UnitApiCase } from "./eval-api";

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
  change:
    | "Recovered"
    | "New failure"
    | "Unchanged"
    | "New test"
    | "Definition changed"
    | "Not compared";
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
      const final = (record: UnitApiCase) =>
        ["passed", "failed"].includes(record.verdict);
      if (comparable && !previous.length) change = "New test";
      else if (
        comparable &&
        records.length === 1 &&
        previous.length === 1 &&
        final(records[0]) &&
        final(previous[0])
      ) {
        change =
          definition(records[0]) !== definition(previous[0])
            ? "Definition changed"
            : previous[0].verdict === records[0].verdict
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
