"use client";
import { useEffect, useRef, useState } from "react";
import type {
  HistoryRun,
  UnitHistoryInsights,
} from "../lib/unit-history-types";
import {
  historyTrendValue,
  type HistoryTrendMetric,
} from "../lib/unit-history-trend";
import { historyTime } from "../lib/unit-history-utils";
import styles from "./unit-history-trend.module.css";
type Reference = NonNullable<HistoryRun["progression"]>["previousExecution"];
const context = (run: HistoryRun) =>
  `${run.stage ?? "unknown"} · ${run.targetEnvironment ?? "Target not recorded"} · ${run.environment ?? "unknown"}`;
export function UnitSkillPerformanceTrend({
  data,
  selectedCohortKey = null,
  visibleRunIds = null,
  focusedBranch,
  onHighlightBranch,
  openingRunId,
  onOpenRun,
  onInspectRun,
  selectedRunId,
  onReferenceRun,
}: {
  data: UnitHistoryInsights;
  selectedCohortKey?: string | null;
  visibleRunIds?: string[] | null;
  focusedBranch: string | null;
  onHighlightBranch: (key: string | null) => void;
  openingRunId: string | null;
  onOpenRun: (id: string, type: "unit") => void;
  onInspectRun?: (id: string) => void;
  selectedRunId?: string;
  onReferenceRun?: (id: string) => void;
}) {
  const [metric, setMetric] = useState<HistoryTrendMetric>("passRate");
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [branches, setBranches] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [width, setWidth] = useState(640);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const allowed = visibleRunIds === null ? null : new Set(visibleRunIds);
  const scoped = data.runs.filter(
    (run) =>
      (!allowed || allowed.has(run.runId)) &&
      (!selectedCohortKey || run.cohortKey === selectedCohortKey),
  );
  const dimensions = [
    ["stage", "Stage"],
    ["targetEnvironment", "Target"],
    ["environment", "Execution environment"],
  ] as const;
  const field = (run: HistoryRun, key: string) =>
    String(run[key as keyof HistoryRun] ?? "Not recorded");
  const matching = scoped.filter((run) =>
    dimensions.every(
      ([key]) =>
        !choices[key]?.length || choices[key].includes(field(run, key)),
    ),
  );
  const seriesKeys = new Set(matching.map((run) => run.branchKey));
  const activeBranches = branches.filter((key) => seriesKeys.has(key));
  const filtered = matching.filter(
    (run) => !activeBranches.length || activeBranches.includes(run.branchKey),
  );
  const measured = [...filtered]
    .reverse()
    .filter((run) => historyTrendValue(run, metric) !== null)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const dayKey = (run: HistoryRun) =>
    new Date(run.startedAt).toISOString().slice(0, 10);
  const days = [...new Set(measured.map(dayKey))].sort().reverse();
  const points = measured.filter((run) => !day || dayKey(run) === day);
  const byId = new Map(points.map((run) => [run.runId, run]));
  const selected =
    points.find((run) => run.runId === selectedRunId) ?? points.at(-1);
  const defaultReference = selected?.progression?.previousExecution?.runId;
  useEffect(() => {
    if (selected?.runId === selectedRunId)
      onReferenceRun?.(defaultReference ?? "none");
  }, [selected?.runId, selectedRunId, defaultReference, onReferenceRun]);
  const open = (id: string) => {
    if (onInspectRun) onInspectRun(id);
    else if (id !== openingRunId) onOpenRun(id, "unit");
  };
  const delta = (reference: Reference | undefined) =>
    metric === "passRate"
      ? reference?.passRateDelta
      : reference?.durationDeltaMs == null
        ? null
        : reference.durationDeltaMs / 1000;
  const label = (reference: Reference | undefined) => {
    const value = delta(reference);
    if (value == null) return "No earlier measurement";
    return `${value > 0 ? "↑" : value < 0 ? "↓" : "→"} ${value > 0 ? "+" : ""}${Number(value.toFixed(1))} ${metric === "passRate" ? "pp" : "s"}`;
  };
  const tone = (reference: Reference | undefined) => {
    const value = delta(reference);
    return value == null || value === 0
      ? styles.neutral
      : (metric === "passRate" ? value > 0 : value < 0)
        ? styles.improved
        : styles.regressed;
  };
  const valueLabel = (run: HistoryRun) =>
    `${Number((historyTrendValue(run, metric) ?? 0).toFixed(1))}${metric === "passRate" ? "%" : "s"}`;
  const toggle = (key: string, value: string) => {
    setChoices((current) => ({
      ...current,
      [key]: current[key]?.includes(value)
        ? current[key].filter((item) => item !== value)
        : [...(current[key] ?? []), value],
    }));
    setDay(null);
    setPage(0);
  };
  const cards = [
    ...new Map(
      measured.map((run) => [
        `${run.progression?.key ?? context(run)}:${run.sourceBranch ?? run.branchKey}`,
        run,
      ]),
    ).values(),
  ];
  const left = 50,
    right = width - 20,
    top = 38,
    bottom = 240,
    height = 330;
  const start =
    day && points.length
      ? Date.parse(points[0].startedAt) - 60000
      : Date.parse(data.startedFrom);
  const end =
    day && points.length
      ? Date.parse(points[points.length - 1].startedAt) + 60000
      : Date.parse(data.startedBefore);
  const x = (run: HistoryRun) =>
    left +
    8 +
    ((Date.parse(run.startedAt) - start) / Math.max(1, end - start)) *
      (right - left - 16);
  const max =
    metric === "passRate"
      ? 100
      : Math.max(
          1,
          ...points.map((run) => historyTrendValue(run, metric) ?? 0),
        ) * 1.1;
  const min =
    metric === "passRate"
      ? Math.max(
          0,
          Math.floor(
            ((points.length
              ? Math.min(
                  ...points.map((run) => historyTrendValue(run, metric) ?? 0),
                )
              : 100) -
              10) /
              10,
          ) * 10,
        )
      : 0;
  const y = (run: HistoryRun) =>
    bottom -
    (((historyTrendValue(run, metric) ?? 0) - min) / Math.max(1, max - min)) *
      (bottom - top);
  const connections = points.flatMap((run) => {
    const ref = run.progression?.previousExecution;
    const before = ref ? byId.get(ref.runId) : undefined;
    return before && ref ? [{ run, before, ref }] : [];
  });
  const slots: Array<{ x: number; y: number }> = [];
  const comparison = (title: string, ref: Reference | undefined) => (
    <div>
      <small>{title}</small>
      <strong className={tone(ref)}>{label(ref)}</strong>
      {ref ? (
        <>
          <small>
            {ref.branch} · {historyTime(ref.startedAt)} · {ref.runId}
          </small>
          <button onClick={() => onReferenceRun?.(ref.runId)}>
            Inspect test differences
          </button>
          {!!ref.warnings?.length && (
            <details>
              <summary>What else changed?</summary>
              <ul>
                {ref.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <small>
          First execution for this comparison in the selected window.
        </small>
      )}
    </div>
  );
  return (
    <section
      className={`panel ${styles.panel}`}
      aria-label="Skill performance trend"
    >
      <div className={`panel-heading ${styles.heading}`}>
        <div>
          <h2>Skill performance over time</h2>
          <p>
            Follow this skill across branches. Each environment and Settings
            group has its own timeline.
          </p>
        </div>
        <label className={styles.metric}>
          Metric
          <select
            aria-label="Skill trend metric"
            value={metric}
            onChange={(event) =>
              setMetric(event.target.value as HistoryTrendMetric)
            }
          >
            <option value="passRate">Pass rate</option>
            <option value="duration">Execution duration</option>
          </select>
        </label>
      </div>
      <div className={styles.filters}>
        {dimensions.map(([key, title]) => (
          <details key={key}>
            <summary>
              {title} · {choices[key]?.length ?? "All"}
            </summary>
            {[...new Set(scoped.map((run) => field(run, key)))]
              .sort()
              .map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={choices[key]?.includes(value) ?? false}
                    onChange={() => toggle(key, value)}
                  />
                  {value}
                </label>
              ))}
          </details>
        ))}
        <button
          onClick={() => {
            setChoices({});
            setBranches([]);
            setDay(null);
            setPage(0);
          }}
        >
          Show all contexts
        </button>
      </div>
      <div className={styles.legend} aria-label="Trend branch highlights">
        {data.branches
          .filter((branch) => seriesKeys.has(branch.key))
          .map((branch) => (
            <button
              key={branch.key}
              aria-pressed={activeBranches.includes(branch.key)}
              className={
                activeBranches.includes(branch.key)
                  ? styles.highlighted
                  : undefined
              }
              onClick={() => {
                setBranches((current) =>
                  current.includes(branch.key)
                    ? current.filter((key) => key !== branch.key)
                    : [...current, branch.key],
                );
                onHighlightBranch(null);
                setPage(0);
              }}
            >
              {branch.label}
            </button>
          ))}
      </div>
      <p className={styles.note}>
        {activeBranches.length
          ? `${activeBranches.length} branch/context series selected`
          : `All ${seriesKeys.size} branch/context series shown`}{" "}
        · Click multiple labels to view them together. Comparisons use recorded
        results; missing metadata does not hide a score difference.
      </p>
      {selected && (
        <div
          className={styles.comparison}
          data-comparison-status={selected.runId}
          aria-live="polite"
        >
          <div>
            <small>SELECTED EXECUTION</small>
            <strong>{valueLabel(selected)}</strong>
            <small>
              {selected.sourceBranch ?? selected.branchLabel} ·{" "}
              {historyTime(selected.startedAt)}
            </small>
            <small>
              {context(selected)} · {selected.runId}
            </small>
          </div>
          {comparison(
            "VS LAST RUN ON THIS BRANCH",
            selected.progression?.previousSameBranch,
          )}
          {comparison(
            "VS PREVIOUS BRANCH’S FINAL RUN",
            selected.progression?.previousBranch,
          )}
        </div>
      )}
      <div className={styles.dayControls}>
        {day ? (
          <>
            <strong>Day detail · {day} UTC</strong>
            <button
              onClick={() => {
                setDay(null);
                setPage(0);
              }}
            >
              Back to full timeline
            </button>
          </>
        ) : (
          <label>
            Zoom into a day
            <select
              aria-label="Zoom into trend day"
              value=""
              onChange={(event) => {
                setDay(event.target.value);
                setPage(0);
              }}
            >
              <option value="" disabled>
                Choose a day · execution count
              </option>
              {days.map((value) => (
                <option key={value} value={value}>
                  {value} ·{" "}
                  {measured.filter((run) => dayKey(run) === value).length} runs
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div ref={container} className={styles.plot}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          role="img"
          aria-label="Chronological skill measurements across branches"
        >
          <title>Recorded performance by execution time</title>
          <text x={left} y="16" className={styles.axisTitle}>
            {metric === "passRate"
              ? "Pass rate (%)"
              : "Execution duration (seconds)"}
          </text>
          {[0, 1, 2, 3, 4].map((i) => {
            const value = min + ((max - min) * i) / 4,
              at = bottom - ((bottom - top) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={right}
                  y1={at}
                  y2={at}
                  className={styles.gridLine}
                />
                <text
                  x={left - 8}
                  y={at + 4}
                  textAnchor="end"
                  className={styles.tick}
                >
                  {Number(value.toFixed(1))}
                  {metric === "passRate" ? "%" : "s"}
                </text>
              </g>
            );
          })}
          {connections.map(({ run, before, ref }) => {
            const d = delta(ref) ?? 0,
              color =
                d === 0
                  ? "#9b7010"
                  : (metric === "passRate" ? d > 0 : d < 0)
                    ? "var(--green)"
                    : "var(--red)";
            const ax = x(before),
              ay = y(before),
              bx = x(run),
              by = y(run),
              dx = bx - ax,
              dy = by - ay,
              len = Math.hypot(dx, dy),
              mx = (ax + bx) / 2,
              my = (ay + by) / 2;
            return (
              <g
                key={run.runId}
                data-trend-reference={ref.runId}
                data-trend-direction={
                  d > 0 ? "higher" : d < 0 ? "lower" : "same"
                }
              >
                <title>{`${label(ref)} vs ${ref.branch} · ${ref.runId}`}</title>
                <line
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray={ref.warnings.length ? "6 3" : undefined}
                />
                {len > 30 && (
                  <polygon
                    points={`${mx + (dx / len) * 6},${my + (dy / len) * 6} ${mx - (dx / len) * 4 - (dy / len) * 4},${my - (dy / len) * 4 + (dx / len) * 4} ${mx - (dx / len) * 4 + (dy / len) * 4},${my - (dy / len) * 4 - (dx / len) * 4}`}
                    fill={color}
                  />
                )}
              </g>
            );
          })}
          {points.map((run) => {
            const px = x(run),
              py = y(run),
              show =
                run.runId === selected?.runId ||
                !slots.some(
                  (slot) =>
                    Math.abs(slot.x - px) < 90 && Math.abs(slot.y - py) < 30,
                );
            if (show) slots.push({ x: px, y: py });
            return (
              <g key={run.runId}>
                <a
                  href={`?view=runs&run=${encodeURIComponent(run.runId)}`}
                  data-trend-run={run.runId}
                  aria-label={`Inspect ${run.sourceBranch ?? run.branchLabel}, ${historyTime(run.startedAt)}, ${valueLabel(run)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    open(run.runId);
                  }}
                >
                  <title>{`${run.sourceBranch ?? run.branchLabel} · ${valueLabel(run)} · ${context(run)} · ${historyTime(run.startedAt)}`}</title>
                  <circle cx={px} cy={py} r="12" fill="transparent" />
                  <circle
                    cx={px}
                    cy={py}
                    r={run.runId === selected?.runId ? 6 : 4}
                    fill="var(--panel)"
                    stroke="var(--blue)"
                    strokeWidth="2"
                  />
                  {show && (
                    <text
                      x={Math.max(left + 30, Math.min(right - 30, px))}
                      y={Math.max(top - 10, py - 14)}
                      textAnchor="middle"
                      className={styles.axisTitle}
                    >
                      {valueLabel(run)}
                    </text>
                  )}
                </a>
              </g>
            );
          })}
          {[0, 1, 2].map((i) => {
            const at = start + ((end - start) * i) / 2;
            return (
              <text
                key={i}
                x={left + ((right - left) * i) / 2}
                y={height - 25}
                textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                className={styles.tick}
              >
                {new Date(at).toLocaleString(
                  "en-US",
                  day
                    ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }
                    : { month: "short", day: "numeric", timeZone: "UTC" },
                )}
              </text>
            );
          })}
          <text
            x={right}
            y={height - 5}
            textAnchor="end"
            className={styles.axisTitle}
          >
            Started (UTC)
          </text>
        </svg>
      </div>
      {!points.length && (
        <p className={styles.note}>
          No measured executions match these filters.
        </p>
      )}
      <p className={styles.note}>
        ↑ Higher · ↓ Lower · → Same recorded value. Dashed lines indicate
        changed tests or incomplete/different evaluator metadata; inspect the
        comparison caveats. Lines never mix environments or Settings groups. The
        previous-branch reference is its last measurement before this branch’s
        first execution. Branches are not inferred PR approvals.{" "}
        {filtered.filter((run) => !run.qualityMeasured).length} executions
        without measured quality remain in the supporting history.
      </p>
      <div className={styles.cards} aria-label="Branch progression cards">
        {(more ? cards : cards.slice(-6)).map((run) => (
          <button
            key={`${run.progression?.key}:${run.sourceBranch ?? run.branchKey}`}
            onClick={() => open(run.runId)}
            aria-pressed={run.runId === selected?.runId}
          >
            <small>{run.sourceBranch ?? run.branchLabel}</small>
            <strong>{valueLabel(run)}</strong>
            <small>{run.progression?.label ?? context(run)}</small>
            <span className={tone(run.progression?.branchStart)}>
              {label(run.progression?.branchStart)} within this branch
            </span>
            <span className={tone(run.progression?.previousBranch)}>
              {label(run.progression?.previousBranch)} vs previous branch
            </span>
            <small>
              {historyTime(run.startedAt)} · latest measured execution
            </small>
          </button>
        ))}
      </div>
      {cards.length > 6 && (
        <button onClick={() => setMore((value) => !value)}>
          {more ? "Show fewer branch cards" : "Show all branch cards"}
        </button>
      )}
      {day && (
        <div className={styles.dayList} aria-label="Day executions">
          <h3>{points.length} executions · exact timestamps</h3>
          {points.slice(page * 20, page * 20 + 20).map((run) => (
            <button
              key={run.runId}
              aria-pressed={run.runId === selected?.runId}
              onClick={() => open(run.runId)}
            >
              {historyTime(run.startedAt)} ·{" "}
              {run.sourceBranch ?? run.branchLabel} · {valueLabel(run)} ·{" "}
              {run.runId}
            </button>
          ))}
          {points.length > 20 && (
            <div>
              <button
                disabled={!page}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous runs
              </button>
              <span>
                {page * 20 + 1}–{Math.min(points.length, page * 20 + 20)} of{" "}
                {points.length}
              </span>
              <button
                disabled={(page + 1) * 20 >= points.length}
                onClick={() => setPage((value) => value + 1)}
              >
                Next runs
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
