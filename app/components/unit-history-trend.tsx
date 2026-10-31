"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { UnitHistoryInsights } from "../lib/unit-history-types";
import { historyTime, rateLabel } from "../lib/unit-history-utils";
import {
  historyTrendCeiling,
  historyTrendSeries,
  type HistoryTrendMetric,
} from "../lib/unit-history-trend";
import styles from "./unit-history-trend.module.css";

const COLORS = ["var(--green)", "var(--blue)", "var(--violet)", "var(--ink)"];
const DASHES = [undefined, "7 3", "2 3", "8 3 2 3"];

export function UnitSkillPerformanceTrend({
  data,
  focusedBranch,
  openingRunId,
  onHighlightBranch,
  onOpenRun,
}: {
  data: UnitHistoryInsights;
  focusedBranch: string | null;
  openingRunId: string | null;
  onHighlightBranch: (key: string | null) => void;
  onOpenRun: (runId: string, evalType: "unit") => void;
}) {
  const [metric, setMetric] = useState<HistoryTrendMetric>("passRate");
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const series = historyTrendSeries(
    data.runs,
    data.branches,
    data,
    metric,
    data.selectedCohortKey,
  );
  const ceiling = historyTrendCeiling(series, metric);
  const height = 270,
    left = 54,
    right = width - 20,
    top = 27,
    bottom = 218;
  const start = Date.parse(data.startedFrom),
    end = Date.parse(data.startedBefore);
  const x = (at: string) =>
    left +
    ((Date.parse(at) - start) / Math.max(end - start, 1)) * (right - left);
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const tickCount = width < 480 ? 3 : 5;
  const unit = metric === "passRate" ? "%" : "s";
  const formatValue = (value: number) =>
    `${Number.isInteger(value) ? value : Number(value.toPrecision(3))}${unit}`;
  const focusPresent = series.some(
    (branch) => branch.branchKey === focusedBranch,
  );
  const pointCount = series.reduce(
    (count, branch) => count + branch.points.length,
    0,
  );
  const openRun = (runId: string) => {
    if (runId !== openingRunId) onOpenRun(runId, "unit");
  };
  return (
    <section
      className={`panel ${styles.panel}`}
      aria-label="Skill performance trend"
    >
      <div className={`panel-heading ${styles.heading}`}>
        <div>
          <h2>Skill performance over time</h2>
          <p>
            {data.scope.skill} · {data.scope.stage} ·{" "}
            {data.scope.targetEnvironment ?? "Target not recorded"}
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
      <div className={styles.legend} aria-label="Trend branch highlights">
        {series.map((branch, index) => (
          <button
            key={branch.branchKey}
            type="button"
            aria-pressed={focusedBranch === branch.branchKey}
            className={
              focusedBranch === branch.branchKey
                ? styles.highlighted
                : undefined
            }
            onClick={() =>
              onHighlightBranch(
                focusedBranch === branch.branchKey ? null : branch.branchKey,
              )
            }
          >
            <span
              style={
                {
                  "--branch-color": COLORS[index % COLORS.length],
                } as CSSProperties
              }
            />
            {branch.label}
          </button>
        ))}
      </div>
      {!pointCount && (
        <div className="empty" role="status">
          {metric === "duration"
            ? "No recorded execution durations in the selected configuration and window."
            : "No recorded pass rates for completed runs in the selected configuration and window."}
        </div>
      )}
      <div className={styles.plot} ref={container} hidden={!pointCount}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`${metric === "passRate" ? "Pass rate" : "Execution duration"} trend across ${series.length} branches; each point opens its run`}
        >
          <title>
            {metric === "passRate"
              ? "Pass rate (%)"
              : "Execution duration (seconds)"}{" "}
            across the selected skill history window
          </title>
          <text className={styles.axisTitle} x={left} y="14">
            {metric === "passRate" ? "Pass rate (%)" : "Duration (s)"}
          </text>
          {[0, 1, 2, 3, 4].map((index) => {
            const value = (ceiling * index) / 4;
            return (
              <g key={index}>
                <line
                  className={styles.gridLine}
                  x1={left}
                  x2={right}
                  y1={y(value)}
                  y2={y(value)}
                />
                <text
                  className={styles.tick}
                  x={left - 9}
                  y={y(value) + 4}
                  textAnchor="end"
                >
                  {formatValue(value)}
                </text>
              </g>
            );
          })}
          {series.map((branch, index) => {
            const color = COLORS[index % COLORS.length];
            const dash =
              DASHES[Math.floor(index / COLORS.length) % DASHES.length];
            const faded = focusPresent && focusedBranch !== branch.branchKey;
            return (
              <g
                key={branch.branchKey}
                opacity={faded ? 0.3 : 1}
                data-trend-branch={branch.branchKey}
              >
                {branch.segments
                  .filter((segment) => segment.length > 1)
                  .map((segment, segmentIndex) => (
                    <polyline
                      key={segmentIndex}
                      data-trend-line={branch.branchKey}
                      pointerEvents="none"
                      fill="none"
                      stroke={color}
                      strokeWidth={focusedBranch === branch.branchKey ? 3 : 2}
                      strokeDasharray={dash}
                      strokeLinejoin="round"
                      points={segment
                        .map(
                          (point) =>
                            `${x(point.run.startedAt)},${y(point.value)}`,
                        )
                        .join(" ")}
                    />
                  ))}
                {branch.points.map(({ run, value }) => {
                  const label = `${branch.label} · ${run.runId} · ${metric === "passRate" ? rateLabel(value) : formatValue(value)} · ${run.passed ?? "?"}/${run.total ?? "?"} passed · ${historyTime(run.startedAt)} · SHA ${run.gitSha?.slice(0, 7) ?? "not recorded"}`;
                  return (
                    <a
                      key={run.runId}
                      href={`?view=runs&run=${encodeURIComponent(run.runId)}`}
                      aria-label={`Open trend run ${run.runId}`}
                      aria-disabled={openingRunId === run.runId}
                      onClick={(event) => {
                        event.preventDefault();
                        openRun(run.runId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === " ") {
                          event.preventDefault();
                          openRun(run.runId);
                        }
                      }}
                      data-trend-run={run.runId}
                    >
                      <title>{label}</title>
                      <circle
                        cx={x(run.startedAt)}
                        cy={y(value)}
                        r="12"
                        fill="transparent"
                      />
                      <circle
                        className={styles.point}
                        cx={x(run.startedAt)}
                        cy={y(value)}
                        r="3.5"
                        fill="var(--panel)"
                        stroke={color}
                        strokeWidth="2"
                      />
                    </a>
                  );
                })}
              </g>
            );
          })}
          {Array.from({ length: tickCount }, (_, index) => {
            const progress = index / (tickCount - 1),
              at = start + progress * (end - start);
            return (
              <text
                key={index}
                className={styles.tick}
                x={left + progress * (right - left)}
                y={bottom + 22}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === tickCount - 1
                      ? "end"
                      : "middle"
                }
              >
                {new Date(at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </text>
            );
          })}
          <text
            className={styles.axisTitle}
            x={right}
            y={height - 6}
            textAnchor="end"
          >
            Started (UTC)
          </text>
        </svg>
      </div>
      <div className={styles.note}>
        {pointCount} completed executions
        {data.selectedCohortKey
          ? " in the selected analysis configuration"
          : " with recorded run summaries"}
        . Each branch has its own series. Lines break when recorded case sets
        change or the metric is missing. Select a point to open its run.
        {pointCount === 1 ? " More runs are needed to establish a trend." : ""}
      </div>
    </section>
  );
}
