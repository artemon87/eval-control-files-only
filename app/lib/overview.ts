import type { EvalRun, EvalType } from "./eval-types";

export type OverviewCounts = {
  runs: number; completed: number; passed: number; failed: number; blocked: number;
  xpassed: number; degraded: number; attention: number; running: number; queued: number;
  total_cases: number; passed_cases: number; timed_completed: number;
  p95_duration_ms: number | null;
};
export type AttentionEntry = { run: EvalRun; degraded: boolean; previous_mean_score: number | null };
export type OverviewData = {
  started_from: string; started_before: string;
  totals: Record<"all" | EvalType, OverviewCounts>;
  days: Array<OverviewCounts & { date: string; eval_type: EvalType | null }>;
  recent_runs: EvalRun[]; blocked_runs: EvalRun[]; attention_runs: AttentionEntry[];
};
export const emptyCounts: OverviewCounts = {
  runs: 0, completed: 0, passed: 0, failed: 0, blocked: 0, xpassed: 0, degraded: 0,
  attention: 0, running: 0, queued: 0, total_cases: 0, passed_cases: 0,
  timed_completed: 0, p95_duration_ms: null,
};

export function overviewView(data: OverviewData | null, type: "all" | EvalType, start: string, end: string) {
  const counts = data?.totals[type] ?? emptyCounts;
  const rows = new Map((data?.days ?? []).map(row => [`${row.date}|${row.eval_type ?? "all"}`, row]));
  const dayMs = 86_400_000;
  const first = Math.floor(Date.parse(start) / dayMs) * dayMs;
  const last = Math.floor((Date.parse(end) - 1) / dayMs) * dayMs;
  const rate = (date: string, kind: "all" | EvalType) => {
    const row = rows.get(`${date}|${kind}`);
    return row?.total_cases ? 100 * row.passed_cases / row.total_cases : undefined;
  };
  const daily = Array.from({length: (last - first) / dayMs + 1}, (_, i) => {
    const date = new Date(first + i * dayMs).toISOString().slice(0, 10);
    return { date, e2e: type === "unit" ? undefined : rate(date, "e2e"),
      unit: type === "e2e" ? undefined : rate(date, "unit") };
  });
  const recent = daily.slice(-7).map(day => rows.get(`${day.date}|${type}`));
  const ofType = (run: EvalRun) => type === "all" || run.evalType === type;
  return { counts, daily, p95: counts.p95_duration_ms,
    inView: (data?.recent_runs ?? []).filter(ofType).sort((a,b) => b.startedAt.localeCompare(a.startedAt)),
    blockedRuns: (data?.blocked_runs ?? []).filter(ofType).sort((a,b) => b.startedAt.localeCompare(a.startedAt)),
    attentionRuns: (data?.attention_runs ?? []).filter(e => ofType(e.run)).sort((a,b) => b.run.startedAt.localeCompare(a.run.startedAt)),
    passSpark: daily.slice(-7).map(day => rate(day.date, type) ?? 0),
    failureSpark: recent.map(row => (row?.blocked ?? 0) + (row?.attention ?? 0)),
    progressSpark: recent.map(row => (row?.running ?? 0) + (row?.queued ?? 0)),
    durationSpark: recent.map(row => row?.p95_duration_ms ?? 0),
  };
}
