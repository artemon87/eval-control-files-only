"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  HistoryRun,
  UnitHistoryInsights,
} from "../lib/unit-history-types";
import {
  HISTORY_TREND_METRICS,
  historyProgression,
  historyTrendValue,
  trendBranch,
  trendContext,
  type HistoryTrendMetric,
  type TrendReference,
} from "../lib/unit-history-trend";
import { historyTime } from "../lib/unit-history-utils";
import styles from "./unit-history-trend.module.css";

// Fixed categorical order; green/red remain reserved for performance status.
const BRANCH_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#6250d6",
];
const OTHER_BRANCH_COLOR = "#8a94a3";
export function UnitSkillPerformanceTrend({
  data,
  visibleRunIds = null,
  openingRunId,
  onOpenRun,
  onInspectRun,
  selectedRunId,
  onCompare,
}: {
  data: UnitHistoryInsights;
  visibleRunIds?: string[] | null;
  openingRunId: string | null;
  onOpenRun: (id: string, type: "unit") => void;
  onInspectRun?: (id: string) => void;
  selectedRunId?: string;
  onCompare?: (referenceRunId: string) => void;
}) {
  const [metric, setMetric] = useState<HistoryTrendMetric>("passRate");
  const [hidden, setHidden] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(true);
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
  const measured = [...data.runs]
    .reverse()
    .filter(
      (run) =>
        (!allowed || allowed.has(run.runId)) &&
        historyTrendValue(run, metric) !== null,
    )
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const progression = historyProgression([...measured].reverse());
  const branchNames = [...new Set(measured.map(trendBranch))];
  const color = (branch: string) =>
    BRANCH_COLORS[branchNames.indexOf(branch)] ?? OTHER_BRANCH_COLOR;
  const contexts = [...new Set([...measured].reverse().map(trendContext))];
  const selected =
    measured.find((run) => run.runId === selectedRunId) ?? measured.at(-1);
  const context = showAll
    ? null
    : selected
      ? trendContext(selected)
      : contexts[0];
  const inContext = measured.filter(
    (run) => !context || trendContext(run) === context,
  );
  const contextBranches = [...new Set(inContext.map(trendBranch))];
  const points = inContext.filter(
    (run) =>
      !hidden.includes(trendBranch(run)) || run.runId === selected?.runId,
  );
  const open = (id: string) => {
    if (onInspectRun) onInspectRun(id);
    else if (id !== openingRunId) onOpenRun(id, "unit");
  };
  const definition = HISTORY_TREND_METRICS[metric];
  const delta = (
    run: HistoryRun,
    reference: TrendReference | null | undefined,
  ) => {
    const now = historyTrendValue(run, metric),
      then = reference ? historyTrendValue(reference.run, metric) : null;
    return now == null || then == null ? null : now - then;
  };
  const label = (
    run: HistoryRun,
    reference: TrendReference | null | undefined,
  ) => {
    const value = delta(run, reference);
    if (value == null) return "—";
    return `${value > 0 ? "↑" : value < 0 ? "↓" : "→"} ${value > 0 ? "+" : ""}${Number(value.toFixed(1))}${definition.deltaUnit}`;
  };
  const tone = (
    run: HistoryRun,
    reference: TrendReference | null | undefined,
  ) => {
    const value = delta(run, reference);
    return value == null || value === 0 || !definition.better
      ? styles.neutral
      : (definition.better === "higher" ? value > 0 : value < 0)
        ? styles.improved
        : styles.regressed;
  };
  const valueLabel = (run: HistoryRun) =>
    `${Number((historyTrendValue(run, metric) ?? 0).toFixed(1))}${definition.unit}`;
  const left = 50,
    right = width - 20,
    top = 30,
    bottom = 240,
    height = 290;
  // Executions are evenly spaced so runs on the same day do not share a date slot.
  const x = (index: number) =>
    points.length < 2
      ? (left + right) / 2
      : left + 16 + (index / (points.length - 1)) * (right - left - 32);
  const values = points.map((run) => historyTrendValue(run, metric) ?? 0);
  const max =
    metric === "passRate"
      ? 100
      : metric === "duration"
        ? Math.max(1, ...values) * 1.1
        : Math.max(4, Math.ceil((Math.max(0, ...values) * 1.1) / 4) * 4);
  const min =
    metric === "passRate"
      ? Math.max(
          0,
          Math.floor(((values.length ? Math.min(...values) : 100) - 10) / 10) *
            10,
        )
      : 0;
  const y = (run: HistoryRun) =>
    bottom -
    (((historyTrendValue(run, metric) ?? 0) - min) / Math.max(1, max - min)) *
      (bottom - top);
  const index = new Map(points.map((run, i) => [run.runId, i]));
  const segments = points.flatMap((run, i) => {
    const before = progression.get(run.runId)?.previousSameBranch?.run;
    const from = before ? index.get(before.runId) : undefined;
    return from === undefined
      ? []
      : [{ run, before: points[from], from, to: i }];
  });
  const handoffs = points.flatMap((run, i) => {
    const step = progression.get(run.runId);
    const from = step?.previousBranch
      ? index.get(step.previousBranch.run.runId)
      : undefined;
    return step?.previousSameBranch || from === undefined
      ? []
      : [{ run, before: points[from], from, to: i }];
  });
  const latestByBranch = new Set(
    contextBranches.map(
      (branch) =>
        points.filter((run) => trendBranch(run) === branch).at(-1)?.runId,
    ),
  );
  const step = selected ? progression.get(selected.runId) : undefined;
  const comparison = (
    title: string,
    reference: TrendReference | null | undefined,
    empty: string,
  ) => (
    <div>
      <small>{title}</small>
      <strong className={tone(selected!, reference)}>
        {reference ? label(selected!, reference) : "—"}
      </strong>
      {reference ? (
        <>
          <small>
            {trendBranch(reference.run)} · {valueLabel(reference.run)} ·{" "}
            {historyTime(reference.run.startedAt)}
          </small>
          {!!reference.changes.length && (
            <small>Also changed: {reference.changes.join(" · ")}</small>
          )}
          {onCompare && (
            <button
              onClick={() => {
                if (selected && selected.runId !== selectedRunId)
                  open(selected.runId);
                onCompare(reference.run.runId);
              }}
            >
              Compare tests
            </button>
          )}
        </>
      ) : (
        <small>{empty}</small>
      )}
    </div>
  );
  // One card per branch in each stage/target, newest first. A card follows the
  // selected execution when it belongs to that branch, otherwise its latest run.
  const cards = contexts.flatMap((name) => {
    const runs = measured.filter((run) => trendContext(run) === name);
    return [...new Set(runs.map(trendBranch))]
      .map((branch) => {
        const own = runs.filter((run) => trendBranch(run) === branch);
        return own.find((run) => run.runId === selected?.runId) ?? own.at(-1)!;
      })
      .reverse();
  });
  return (
    <section
      className={`panel ${styles.panel}`}
      aria-label="Skill performance trend"
    >
      <div className={`panel-heading ${styles.heading}`}>
        <div>
          <h2>Skill performance over time</h2>
          <p>
            Lines follow a branch within each stage and target; dashed lines
            show where a branch picked up from the previous one.
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
            {Object.entries(HISTORY_TREND_METRICS).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {contexts.length > 1 && (
        <div className={styles.contexts} aria-label="Trend stage and target">
          <button aria-pressed={showAll} onClick={() => setShowAll(true)}>
            All stages &amp; targets
          </button>
          {contexts.map((name) => (
            <button
              key={name}
              aria-pressed={name === context}
              onClick={() => {
                setShowAll(false);
                if (!selected || trendContext(selected) !== name)
                  open(
                    measured.filter((run) => trendContext(run) === name).at(-1)!
                      .runId,
                  );
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className={styles.legend} aria-label="Trend branches">
        {contextBranches.map((branch) => (
          <button
            key={branch}
            aria-pressed={!hidden.includes(branch)}
            className={hidden.includes(branch) ? styles.muted : undefined}
            style={{ "--branch-color": color(branch) } as CSSProperties}
            onClick={() =>
              setHidden((current) =>
                current.includes(branch)
                  ? current.filter((item) => item !== branch)
                  : [...current, branch],
              )
            }
          >
            <span />
            {branch}
          </button>
        ))}
      </div>
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
              {trendBranch(selected)} · {historyTime(selected.startedAt)}
            </small>
            <small>{trendContext(selected)}</small>
          </div>
          {comparison(
            "VS LAST RUN ON THIS BRANCH",
            step?.previousSameBranch,
            "First run of this branch in the selected window.",
          )}
          {comparison(
            step?.previousBranch
              ? `VS ${trendBranch(step.previousBranch.run).toUpperCase()}`
              : "VS PREVIOUS BRANCH",
            step?.previousBranch,
            "No other branch ran on this stage and target earlier in the selected window.",
          )}
        </div>
      )}
      <div ref={container} className={styles.plot}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          role="img"
          aria-label="Chronological skill measurements across branches"
        >
          <title>Recorded performance by execution</title>
          <text x={left} y="14" className={styles.axisTitle}>
            {definition.axis}
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
                  {metric === "passRate"
                    ? "%"
                    : metric === "duration"
                      ? "s"
                      : ""}
                </text>
              </g>
            );
          })}
          {handoffs.map(({ run, before, from, to }) => (
            <line
              key={`handoff:${run.runId}`}
              data-trend-handoff={before.runId}
              x1={x(from)}
              y1={y(before)}
              x2={x(to)}
              y2={y(run)}
              stroke={OTHER_BRANCH_COLOR}
              strokeWidth="2"
              strokeDasharray="5 4"
            />
          ))}
          {segments.map(({ run, before, from, to }) => (
            <line
              key={`segment:${run.runId}`}
              data-trend-segment={before.runId}
              x1={x(from)}
              y1={y(before)}
              x2={x(to)}
              y2={y(run)}
              stroke={color(trendBranch(run))}
              strokeWidth="2"
            />
          ))}
          {points.map((run, i) => {
            const isSelected = run.runId === selected?.runId;
            return (
              <a
                key={run.runId}
                href={`?view=runs&run=${encodeURIComponent(run.runId)}`}
                data-trend-run={run.runId}
                aria-label={`Inspect ${trendBranch(run)}, ${historyTime(run.startedAt)}, ${valueLabel(run)}`}
                onClick={(event) => {
                  event.preventDefault();
                  open(run.runId);
                }}
              >
                <title>{`${trendBranch(run)} · ${valueLabel(run)} · ${historyTime(run.startedAt)} · ${run.runId}`}</title>
                <circle cx={x(i)} cy={y(run)} r="12" fill="transparent" />
                <circle
                  cx={x(i)}
                  cy={y(run)}
                  r={isSelected ? 6 : 4}
                  fill={isSelected ? color(trendBranch(run)) : "var(--panel)"}
                  stroke={color(trendBranch(run))}
                  strokeWidth="2"
                />
                {(isSelected || latestByBranch.has(run.runId)) && (
                  <text
                    x={Math.max(left + 20, Math.min(right - 20, x(i)))}
                    y={Math.max(top - 6, y(run) - 12)}
                    textAnchor="middle"
                    className={styles.pointLabel}
                  >
                    {valueLabel(run)}
                  </text>
                )}
              </a>
            );
          })}
          {points.length > 0 &&
            [
              ...new Set([
                0,
                Math.floor((points.length - 1) / 2),
                points.length - 1,
              ]),
            ].map((i) => (
              <text
                key={i}
                x={x(i)}
                y={height - 22}
                textAnchor={
                  points.length < 2
                    ? "middle"
                    : i === 0
                      ? "start"
                      : i === points.length - 1
                        ? "end"
                        : "middle"
                }
                className={styles.tick}
              >
                {new Date(points[i].startedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "UTC",
                })}
              </text>
            ))}
          <text
            x={right}
            y={height - 4}
            textAnchor="end"
            className={styles.axisTitle}
          >
            Executions in order (UTC)
          </text>
        </svg>
      </div>
      {!points.length && (
        <p className={styles.note}>No measured executions in this window.</p>
      )}
      <div className={styles.cards} aria-label="Branch progression cards">
        {cards
          .filter((run, i) => more || i < 6 || run.runId === selected?.runId)
          .map((run) => {
            const item = progression.get(run.runId);
            return (
              <button
                key={run.runId}
                onClick={() => open(run.runId)}
                aria-pressed={run.runId === selected?.runId}
              >
                <small className={styles.cardBranch}>
                  <span style={{ background: color(trendBranch(run)) }} />
                  {trendBranch(run)}
                </small>
                <strong>{valueLabel(run)}</strong>
                <small>{trendContext(run)}</small>
                <span className={tone(run, item?.branchStart)}>
                  {item?.branchStart && item.branchStart.run.runId !== run.runId
                    ? `${label(run, item.branchStart)} within this branch`
                    : "Single run on this branch"}
                </span>
                <span className={tone(run, item?.previousBranch)}>
                  {item?.previousBranch
                    ? `${label(run, item.previousBranch)} vs ${trendBranch(item.previousBranch.run)}`
                    : "No earlier branch to compare"}
                </span>
                <small>
                  {historyTime(run.startedAt)} ·{" "}
                  {run.runId === selected?.runId
                    ? "selected execution"
                    : "latest measured execution"}
                </small>
              </button>
            );
          })}
      </div>
      {cards.length > 6 && (
        <button
          className={styles.moreCards}
          onClick={() => setMore((value) => !value)}
        >
          {more
            ? "Show fewer branch cards"
            : `Show all ${cards.length} branch cards`}
        </button>
      )}
    </section>
  );
}
