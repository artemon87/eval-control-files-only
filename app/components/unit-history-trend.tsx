"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { UnitHistoryInsights } from "../lib/unit-history-types";
import { historyTime, rateLabel } from "../lib/unit-history-utils";
import {
  isOperationalHistoryRun,
  historyTrendValue,
  historyTrendConnections,
  historyContextConnections,
  historyTrendCeiling,
  historyTrendSeries,
  type HistoryTrendMetric,
} from "../lib/unit-history-trend";
import styles from "./unit-history-trend.module.css";

const COLORS = ["var(--green)", "var(--blue)", "var(--violet)", "var(--ink)"];
const DASHES = [undefined, "7 3", "2 3", "8 3 2 3"];

export function UnitSkillPerformanceTrend({
  data,
  selectedCohortKey = null,
  focusedBranch,
  openingRunId,
  onHighlightBranch,
  onOpenRun,
  onInspectRun,
  selectedRunId,
}: {
  onInspectRun?: (runId: string) => void;
  selectedRunId?: string;
  selectedCohortKey?: string | null;
  data: UnitHistoryInsights;
  focusedBranch: string | null;
  openingRunId: string | null;
  onHighlightBranch: (key: string | null) => void;
  onOpenRun: (runId: string, evalType: "unit") => void;
}) {
  const [showContextLinks, setShowContextLinks] = useState(true);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [zoomDay, setZoomDay] = useState<string | null>(null);
  const [dayPage, setDayPage] = useState(0);
  const [crowdedChoices, setCrowdedChoices] = useState<string[]>([]);
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
  const configuration = data.cohorts.find(
    (cohort) => cohort.key === selectedCohortKey,
  );
  const allSeries = historyTrendSeries(
    data.runs.map((run) => ({
      ...run,
      caseSetKey: data.cohorts.find((cohort) => cohort.key === run.cohortKey)
        ?.configurationComplete
        ? run.caseSetKey
        : null,
    })),
    data.branches,
    data,
    metric,
    selectedCohortKey,
  );
  const dayKey = (at: string) => new Date(at).toISOString().slice(0, 10);
  const series = zoomDay
    ? allSeries
        .map((branch) => ({
          ...branch,
          points: branch.points.filter(
            (point) => dayKey(point.run.startedAt) === zoomDay,
          ),
          segments: branch.segments.map((segment) =>
            segment.filter((point) => dayKey(point.run.startedAt) === zoomDay),
          ),
        }))
        .filter((branch) => branch.points.length)
    : allSeries;
  const operational = data.runs.filter(
    (run) =>
      isOperationalHistoryRun(run) &&
      (!zoomDay || dayKey(run.startedAt) === zoomDay),
  );
  const days = new Map<string, number>();
  allSeries.forEach((branch) =>
    branch.points.forEach(({ run }) => {
      const key = dayKey(run.startedAt);
      days.set(key, (days.get(key) ?? 0) + 1);
    }),
  );
  const enterDay = (day: string) => {
    setZoomDay(day);
    setDayPage(0);
    setCrowdedChoices([]);
  };
  const directionLabel = (run: UnitHistoryInsights["runs"][number]) => {
    if (run.trendTransition === "settings_changed")
      return "◆ Settings changed · no comparable delta";
    const delta =
      metric === "passRate"
        ? run.trendPassRateDelta
        : run.trendDurationDeltaMs == null
          ? null
          : run.trendDurationDeltaMs / 1000;
    if (run.trendTransition !== "comparable" || delta == null)
      return run.trendContextChanges?.length
        ? `◆ ${run.trendContextChanges.join(" · ")} · chronology only`
        : (run.trendNote ?? "No earlier comparable run in this window");
    const good = metric === "passRate" ? delta > 0 : delta < 0;
    return `${delta === 0 ? "→ Same" : good ? "↗ Improved" : "↘ Regressed"} · ${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))} ${metric === "passRate" ? "pp" : "s"} vs ${run.trendPreviousRunId}`;
  };
  const summaryBranch =
    series.find((branch) => branch.branchKey === focusedBranch) ??
    (series.length === 1 ? series[0] : undefined);
  const latest = summaryBranch?.points.at(-1);
  const dayRuns = data.runs.filter(
    (run) =>
      zoomDay &&
      dayKey(run.startedAt) === zoomDay &&
      (!selectedCohortKey || run.cohortKey === selectedCohortKey),
  );
  const labelSlots: Array<{ x: number; y: number }> = [];
  const dayBadgeSlots: number[] = [];
  const contextEdges = showContextLinks
    ? historyContextConnections(series)
    : [];
  const explainedPoints = new Set(
    contextEdges.flatMap((edge) => [
      edge.previous.run.runId,
      edge.point.run.runId,
    ]),
  );
  const isolationSlots: Array<{ x: number; y: number }> = [];
  const ceiling = historyTrendCeiling(series, metric);
  const floor =
    metric === "passRate" && series.some((branch) => branch.points.length)
      ? Math.max(
          0,
          Math.floor(
            (series.reduce(
              (minimum, branch) =>
                branch.points.reduce(
                  (value, point) => Math.min(value, point.value),
                  minimum,
                ),
              100,
            ) -
              5) /
              10,
          ) * 10,
        )
      : 0;
  const height = 310,
    left = 54,
    right = width - 20,
    top = 27,
    bottom = 200;
  // This is a viewport zoom only: the server-resolved query window is unchanged.
  const dayTimes = zoomDay
    ? [
        ...series.flatMap((branch) =>
          branch.points.map((point) => Date.parse(point.run.startedAt)),
        ),
        ...operational.map((run) => Date.parse(run.startedAt)),
      ]
    : [];
  const dayMinimum = dayTimes.length
    ? dayTimes.reduce((minimum, time) => Math.min(minimum, time), Infinity)
    : zoomDay
      ? Date.parse(`${zoomDay}T00:00:00Z`)
      : 0;
  const dayMaximum = dayTimes.length
    ? dayTimes.reduce((maximum, time) => Math.max(maximum, time), -Infinity)
    : dayMinimum + 86400000;
  const zoomPadding = Math.max(15 * 60000, (dayMaximum - dayMinimum) * 0.08);
  const start = zoomDay
    ? Math.max(
        Date.parse(data.startedFrom),
        Date.parse(`${zoomDay}T00:00:00Z`),
        dayMinimum - zoomPadding,
      )
    : Date.parse(data.startedFrom);
  const end = zoomDay
    ? Math.min(
        Date.parse(data.startedBefore),
        Date.parse(`${zoomDay}T00:00:00Z`) + 86400000,
        dayMaximum + zoomPadding,
      )
    : Date.parse(data.startedBefore);
  const x = (at: string) =>
    left +
    ((Date.parse(at) - start) / Math.max(end - start, 1)) * (right - left);
  const y = (value: number) =>
    bottom - ((value - floor) / Math.max(ceiling - floor, 1)) * (bottom - top);
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
    if (onInspectRun) onInspectRun(runId);
    else if (runId !== openingRunId) onOpenRun(runId, "unit");
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
            {data.scope.skill} · each series identifies its stage, target and
            branch
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
      <div className={styles.summary} aria-live="polite">
        {latest ? (
          <>
            <strong>Latest {formatValue(latest.value)}</strong>
            <span
              className={
                directionLabel(latest.run).startsWith("↗")
                  ? styles.improved
                  : directionLabel(latest.run).startsWith("↘")
                    ? styles.regressed
                    : styles.neutral
              }
            >
              {directionLabel(latest.run)}
            </span>
            <small>
              {summaryBranch?.label} · {historyTime(latest.run.startedAt)}
            </small>
          </>
        ) : (
          <span>
            {series.length} separate series · select a branch to see its latest
            direction
          </span>
        )}
      </div>
      <div className={styles.dayControls}>
        {zoomDay ? (
          <>
            <strong>Day detail · {zoomDay} UTC</strong>
            <button
              className="secondary-button"
              onClick={() => {
                setZoomDay(null);
                setCrowdedChoices([]);
              }}
            >
              Back to full window
            </button>
          </>
        ) : (
          <label>
            Zoom into a day{" "}
            <select
              aria-label="Zoom into trend day"
              value=""
              onChange={(event) => enterDay(event.target.value)}
            >
              <option value="" disabled>
                Choose a day · execution count
              </option>
              {[...days]
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([day, count]) => (
                  <option key={day} value={day}>
                    {day} · {count} executions
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.legend} aria-label="Trend branch highlights">
        {series
          .slice(0, showAllBranches ? undefined : 6)
          .map((branch, index) => (
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
      {series.length > 6 && (
        <button
          className="secondary-button"
          onClick={() => setShowAllBranches((value) => !value)}
        >
          {showAllBranches
            ? "Show fewer branches"
            : `Show ${series.length - 6} more branches`}
        </button>
      )}
      {!pointCount && (
        <div className="empty" role="status">
          {metric === "duration"
            ? "No complete quality measurements with recorded durations in this configuration and window."
            : "No complete quality measurements in this configuration and window."}
        </div>
      )}
      <div
        className={styles.plot}
        ref={container}
        hidden={!pointCount && !operational.length}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`${metric === "passRate" ? "Pass rate" : "Execution duration"} trend across ${series.length} branches; each point opens its run`}
        >
          <title>{`${metric === "passRate" ? "Pass rate (%)" : "Execution duration (seconds)"} across the selected skill history window`}</title>
          <text className={styles.axisTitle} x={left} y="14">
            {metric === "passRate" ? "Pass rate (%)" : "Duration (s)"}
          </text>
          {[0, 1, 2, 3, 4].map((index) => {
            const value = floor + ((ceiling - floor) * index) / 4;
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
          {contextEdges.map((edge) => {
            const ax = x(edge.previous.run.startedAt),
              ay = y(edge.previous.value);
            const bx = x(edge.point.run.startedAt),
              by = y(edge.point.value);
            const mx = Math.max(left + 75, Math.min(right - 75, (ax + bx) / 2));
            const my = Math.max(top + 15, (ay + by) / 2 - 14);
            const showLabel =
              Math.hypot(bx - ax, by - ay) >= 100 &&
              !labelSlots.some(
                (p) => Math.abs(p.x - mx) < 160 && Math.abs(p.y - my) < 28,
              );
            if (showLabel) labelSlots.push({ x: mx, y: my });
            return (
              <g
                key={`context-${edge.point.run.runId}`}
                data-context-link={edge.point.run.runId}
                pointerEvents="none"
                opacity={
                  focusPresent &&
                  ![
                    edge.previous.run.branchKey,
                    edge.point.run.branchKey,
                  ].includes(focusedBranch ?? "")
                    ? 0.25
                    : 1
                }
              >
                <title>{`${edge.label} · chronology only, no performance comparison · ${edge.previous.run.runId} to ${edge.point.run.runId}`}</title>
                <line
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke="#9b7010"
                  strokeWidth="1.5"
                  strokeDasharray="3 5"
                />
                <polygon
                  points={`${bx},${by - 6} ${bx + 6},${by} ${bx},${by + 6} ${bx - 6},${by}`}
                  fill="var(--panel)"
                  stroke="#9b7010"
                  strokeWidth="1.5"
                />
                {showLabel && (
                  <g>
                    <rect
                      x={mx - 74}
                      y={my - 13}
                      width="148"
                      height="21"
                      rx="4"
                      fill="var(--panel)"
                    />
                    <text
                      x={mx}
                      y={my + 1}
                      textAnchor="middle"
                      fill="#9b7010"
                      fontSize="10"
                    >
                      {edge.point.run.trendContextChanges?.length === 1
                        ? edge.label
                        : "Stage / target changed"}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {series.map((branch, index) => {
            const edges = historyTrendConnections(branch, metric);
            const connectedRuns = new Set(
              edges.flatMap((edge) => [
                edge.previous.run.runId,
                edge.point.run.runId,
              ]),
            );
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
                {edges.map((edge) => {
                  const ax = x(edge.previous.run.startedAt),
                    ay = y(edge.previous.value),
                    bx = x(edge.point.run.startedAt),
                    by = y(edge.point.value);
                  const dx = bx - ax,
                    dy = by - ay,
                    length = Math.hypot(dx, dy);
                  const tone =
                    edge.direction === "improved"
                      ? "var(--green)"
                      : edge.direction === "regressed"
                        ? "var(--red)"
                        : ["changed", "same"].includes(edge.direction)
                          ? "#9b7010"
                          : color;
                  const mx = (ax + bx) / 2,
                    my = (ay + by) / 2;
                  const label =
                    edge.delta == null
                      ? ""
                      : `${edge.delta > 0 ? "+" : ""}${Number(edge.delta.toFixed(1))} ${metric === "passRate" ? "pp" : "s"}`;
                  const lx = Math.max(left + 35, Math.min(right - 35, mx)),
                    ly = Math.max(top + 13, Math.min(bottom - 8, my - 12));
                  const showLabel =
                    edge.direction !== "changed" &&
                    label &&
                    length >= 85 &&
                    (branch.branchKey === focusedBranch ||
                      series.length === 1) &&
                    !labelSlots.some(
                      (p) => Math.abs(p.x - lx) < 80 && Math.abs(p.y - ly) < 30,
                    );
                  if (showLabel) labelSlots.push({ x: lx, y: ly });
                  const ux = length ? dx / length : 0,
                    uy = length ? dy / length : 0;
                  return (
                    <g
                      key={`direction-${edge.point.run.runId}`}
                      data-trend-direction={edge.direction}
                      pointerEvents="none"
                    >
                      <line
                        x1={ax}
                        y1={ay}
                        x2={bx}
                        y2={by}
                        stroke={tone}
                        strokeWidth="2"
                        strokeDasharray={
                          edge.direction === "changed" ? "5 5" : dash
                        }
                      />
                      {edge.direction === "changed" ? (
                        <polygon
                          points={`${bx},${by - 6} ${bx + 6},${by} ${bx},${by + 6} ${bx - 6},${by}`}
                          fill={tone}
                        >
                          <title>{`Settings changed · ${edge.point.run.runId}`}</title>
                        </polygon>
                      ) : (
                        length >= 35 && (
                          <polygon
                            points={`${mx + ux * 6},${my + uy * 6} ${mx - ux * 4 - uy * 4},${my - uy * 4 + ux * 4} ${mx - ux * 4 + uy * 4},${my - uy * 4 - ux * 4}`}
                            fill={tone}
                          />
                        )
                      )}
                      {showLabel && (
                        <g>
                          <rect
                            x={lx - 34}
                            y={ly - 13}
                            width="68"
                            height="20"
                            rx="4"
                            fill="var(--panel)"
                          />
                          <text
                            x={lx}
                            y={ly + 1}
                            textAnchor="middle"
                            fill={tone}
                            fontSize="11"
                          >
                            {edge.direction === "same" ? "→ Same" : label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
                {branch.points.map(({ run, value }) => {
                  const label = `${directionLabel(run)} · ${branch.label} · BSA ${run.bsaVersion ?? "not recorded"} · Skill ${run.skillVersion ?? "not recorded"} · Agent ${run.agentName ?? "not recorded"} · ${run.runId} · ${metric === "passRate" ? rateLabel(value) : formatValue(value)} · ${run.passed ?? "?"}/${run.total ?? "?"} passed · ${historyTime(run.startedAt)} · SHA ${run.gitSha?.slice(0, 8) ?? "not recorded"}`;
                  const isolated =
                    !explainedPoints.has(run.runId) &&
                    !connectedRuns.has(run.runId);
                  const ix = Math.max(
                    left + 65,
                    Math.min(right - 65, x(run.startedAt)),
                  );
                  const iy = Math.min(bottom - 8, y(value) + 22);
                  const showIsolation =
                    isolated &&
                    !isolationSlots.some(
                      (p) =>
                        Math.abs(p.x - ix) < 145 && Math.abs(p.y - iy) < 28,
                    );
                  if (showIsolation) isolationSlots.push({ x: ix, y: iy });
                  return (
                    <a
                      key={run.runId}
                      href={`?view=runs&run=${encodeURIComponent(run.runId)}`}
                      aria-label={`Open trend run ${run.runId}`}
                      aria-disabled={openingRunId === run.runId}
                      onClick={(event) => {
                        event.preventDefault();
                        const nearby = series
                          .flatMap((item) => item.points)
                          .filter(
                            (point) =>
                              Math.abs(
                                x(point.run.startedAt) - x(run.startedAt),
                              ) < 18 &&
                              Math.abs(y(point.value) - y(value)) < 18,
                          );
                        if (
                          !zoomDay &&
                          (days.get(dayKey(run.startedAt)) ?? 0) > 3
                        )
                          enterDay(dayKey(run.startedAt));
                        else if (nearby.length > 1) {
                          enterDay(dayKey(run.startedAt));
                          setCrowdedChoices(
                            nearby.map((point) => point.run.runId),
                          );
                        } else openRun(run.runId);
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
                      {showIsolation && (
                        <text
                          data-trend-isolated={run.runId}
                          x={ix}
                          y={iy}
                          textAnchor="middle"
                          fill="var(--muted)"
                          fontSize="10"
                        >
                          {run.trendTransition === "incomplete"
                            ? "Comparison unavailable"
                            : "No earlier comparable run"}
                        </text>
                      )}
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
                        r={selectedRunId === run.runId ? "5" : "3.5"}
                        fill="var(--panel)"
                        stroke={color}
                        strokeWidth={selectedRunId === run.runId ? "3" : "2"}
                      />
                    </a>
                  );
                })}
              </g>
            );
          })}
          {!zoomDay &&
            !operational.length &&
            [...days]
              .filter(([, count]) => count > 3)
              .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
              .map(([day, count]) => {
                const dayPoints = allSeries
                  .flatMap((branch) => branch.points)
                  .filter((point) => dayKey(point.run.startedAt) === day);
                const center =
                  dayPoints.reduce(
                    (sum, point) => sum + x(point.run.startedAt),
                    0,
                  ) / dayPoints.length;
                const cx = Math.max(left + 54, Math.min(right - 54, center));
                if (dayBadgeSlots.some((value) => Math.abs(value - cx) < 112))
                  return null;
                dayBadgeSlots.push(cx);
                return (
                  <a
                    key={day}
                    href={`#trend-day-${day}`}
                    aria-label={`Zoom into ${day}: ${count} executions`}
                    data-trend-day={day}
                    onClick={(event) => {
                      event.preventDefault();
                      enterDay(day);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === " ") {
                        event.preventDefault();
                        enterDay(day);
                      }
                    }}
                  >
                    <rect
                      x={cx - 52}
                      y={bottom + 10}
                      width="104"
                      height="25"
                      rx="5"
                      fill="var(--panel)"
                      stroke="var(--line)"
                    />
                    <text
                      x={cx}
                      y={bottom + 27}
                      textAnchor="middle"
                      className={styles.tick}
                    >
                      {count} runs · {day.slice(5)}
                    </text>
                  </a>
                );
              })}
          {!!operational.length && (
            <g aria-label="Execution issues · no quality measurement">
              <text className={styles.axisTitle} x={left} y="224">
                Blocked / execution error · no quality score
              </text>
              <line
                className={styles.gridLine}
                x1={left}
                x2={right}
                y1="240"
                y2="240"
              />
              {operational.map((run) => (
                <a
                  key={run.runId}
                  href={`?view=runs&run=${encodeURIComponent(run.runId)}`}
                  aria-label={`Inspect execution issue ${run.runId}`}
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
                >
                  <title>{`${run.branchLabel} · ${run.runId} · ${run.error ?? "Recorded execution issue"}`}</title>
                  <circle
                    cx={x(run.startedAt)}
                    cy="240"
                    r="12"
                    fill="transparent"
                  />
                  <circle
                    cx={x(run.startedAt)}
                    cy="240"
                    r="4"
                    fill="var(--muted)"
                  />
                </a>
              ))}
            </g>
          )}
          {Array.from({ length: tickCount }, (_, index) => {
            const progress = index / (tickCount - 1),
              at = start + progress * (end - start);
            return (
              <text
                key={index}
                className={styles.tick}
                x={left + progress * (right - left)}
                y={height - 26}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === tickCount - 1
                      ? "end"
                      : "middle"
                }
              >
                {zoomDay
                  ? new Date(at).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: "UTC",
                    })
                  : new Date(at).toLocaleDateString("en-US", {
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
      <div className={styles.directionLegend}>
        <label>
          <input
            type="checkbox"
            checked={showContextLinks}
            onChange={(event) => setShowContextLinks(event.target.checked)}
          />{" "}
          Connect stage / target changes
        </label>
        <span>↗ Improved</span>
        <span>↘ Regressed</span>
        <span>→ Same</span>
        <span>◆ Settings / context changed · dotted = chronology only</span>
      </div>
      {!!zoomDay && (
        <div className={styles.dayList} aria-label="Day executions">
          <h3>
            {dayRuns.length} executions · {zoomDay} UTC
          </h3>
          {crowdedChoices.length > 1 && (
            <p role="status">Overlapping points: choose an execution below.</p>
          )}
          {dayRuns.slice(dayPage * 20, dayPage * 20 + 20).map((run) => (
            <button
              key={run.runId}
              aria-pressed={run.runId === selectedRunId}
              className="secondary-button"
              onClick={() => openRun(run.runId)}
            >
              {historyTime(run.startedAt)} · {run.branchLabel} · {run.runId} ·
              SHA {run.gitSha?.slice(0, 7) ?? "not recorded"} ·{" "}
              {rateLabel(run.passRatePct)}
              <small>{directionLabel(run)}</small>
            </button>
          ))}
          {dayRuns.length > 20 && (
            <div>
              <button
                disabled={dayPage === 0}
                onClick={() => setDayPage((p) => p - 1)}
              >
                Previous runs
              </button>
              <span>
                {" "}
                {dayPage * 20 + 1}–
                {Math.min((dayPage + 1) * 20, dayRuns.length)} of{" "}
                {dayRuns.length}{" "}
              </span>
              <button
                disabled={(dayPage + 1) * 20 >= dayRuns.length}
                onClick={() => setDayPage((p) => p + 1)}
              >
                Next runs
              </button>
            </div>
          )}
        </div>
      )}
      <div className={styles.note}>
        Showing {pointCount} of{" "}
        {
          data.runs.filter((run) => historyTrendValue(run, metric) !== null)
            .length
        }{" "}
        measured executions
        {selectedCohortKey
          ? " in the selected analysis configuration"
          : " with recorded run summaries"}
        . Dates are on the horizontal axis. Lines join comparable updates within
        the same branch only; no main-branch baseline or PR approval is assumed.
        Dotted links show settings or stage/target changes on the same source
        branch; they do not indicate improvement or regression. Missing
        measurements break connections. Select a point to inspect its execution.{" "}
        {operational.length} executions with recorded issues are shown
        separately and do not contribute quality scores.
        {selectedCohortKey &&
          !configuration?.configurationComplete &&
          " Recorded configuration is incomplete; performance comparisons are unavailable. Dotted chronology links may still be shown."}
        {pointCount === 1 ? " More runs are needed to establish a trend." : ""}
      </div>
    </section>
  );
}
