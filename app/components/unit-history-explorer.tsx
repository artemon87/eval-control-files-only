"use client";

import { useEffect, useState } from "react";
import type { EvalApi } from "../lib/eval-api";
import { useHistoryWindow } from "../lib/use-history-window";
import type {
  UnitHistoryFocus,
  UnitHistoryInsights,
  UnitHistoryQuery,
  UnitHistoryScope,
} from "../lib/unit-history-types";
import { historyTime, skillScopeKey } from "../lib/unit-history-utils";
import { UnitTrendExplorerContent } from "./unit-trend-explorer-content";
import styles from "./unit-history-layout.module.css";

interface Props {
  api: EvalApi | null;
  revision: number;
  initialFocus?: UnitHistoryFocus;
  openingRunId: string | null;
  onOpenRun: (runId: string, evalType: "unit") => void;
  onShowE2E: () => void;
}

export function UnitHistoryTrendExplorer({
  api,
  revision,
  initialFocus,
  onShowE2E,
  ...navigation
}: Props) {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const [refresh, setRefresh] = useState(0);
  const [skillChoice, setSkillChoice] = useState("");
  const [stageChoice, setStageChoice] = useState("all");
  const [targetChoice, setTargetChoice] = useState("all");
  const [cohortChoice, setCohortChoice] = useState({
    key: "",
    scopeKey: "",
    revision: 0,
  });
  const [catalog, setCatalog] = useState<{
    items: UnitHistoryScope[];
    loaded: boolean;
    error: string | null;
  }>({ items: [], loaded: false, error: null });
  const [response, setResponse] = useState<{
    key: string;
    data: UnitHistoryInsights | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const resolvedWindow = useHistoryWindow(api, range, revision, refresh);
  const timeWindow = resolvedWindow.window;

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api
      .listUnitHistoryScopes(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted)
          setCatalog({ items, loaded: true, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setCatalog((current) => ({
            ...current,
            loaded: true,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load History scopes",
          }));
      });
    return () => controller.abort();
  }, [api, revision, refresh]);

  const skills = Array.from(
    new Map(
      catalog.items.map((scope) => [skillScopeKey(scope), scope]),
    ).values(),
  );
  const preferred = catalog.items.find(
    (scope) => scope.skill === initialFocus?.skillId,
  );
  const skill =
    skills.find((scope) => skillScopeKey(scope) === skillChoice) ??
    preferred ??
    skills[0];
  const skillScopes = catalog.items.filter(
    (scope) => skill && skillScopeKey(scope) === skillScopeKey(skill),
  );
  const stages = [...new Set(skillScopes.map((scope) => scope.stage))].sort();
  const stage =
    stageChoice === "all"
      ? "all"
      : stages.includes(stageChoice)
        ? stageChoice
        : "all";
  const targets = skillScopes.filter(
    (scope) => stage === "all" || scope.stage === stage,
  );
  const scope =
    targets.find((item) => item.scopeKey === targetChoice) ?? targets[0];
  const requestKey = JSON.stringify({
    query: {
      scopeKey: scope?.scopeKey,
      allStages: stage === "all",
      allTargets: targetChoice === "all",
      ...timeWindow,
    },
    refresh,
  });

  useEffect(() => {
    if (!api) return;
    const { query } = JSON.parse(requestKey) as { query: UnitHistoryQuery };
    if (!query.scopeKey || !query.startedFrom || !query.startedBefore) return;
    const controller = new AbortController();
    void api
      .getUnitHistoryInsights(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResponse({
            key: requestKey,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load skill history",
          });
      });
    return () => controller.abort();
  }, [api, requestKey]);

  const refreshHistory = () => {
    setRefresh((value) => value + 1);
  };
  const resetCohort = () =>
    setCohortChoice({ key: "", scopeKey: "", revision });
  const loading =
    Boolean(scope) &&
    !resolvedWindow.error &&
    (resolvedWindow.loading || response.key !== requestKey);
  const data = response.key === requestKey ? response.data : null;
  const settingsGroups =
    data?.settingsGroups ??
    data?.cohorts.map((item) => ({
      key: item.key,
      label: item.label,
      cohortKeys: [item.key],
      runIds: data.runs
        .filter((run) => run.cohortKey === item.key)
        .map((run) => run.runId),
    })) ??
    [];
  const selectedSettings = settingsGroups.find(
    (group) => group.key === cohortChoice.key,
  );
  const error =
    resolvedWindow.error ??
    (response.key === requestKey ? response.error : null);
  return (
    <div className={styles.root}>
      <div className="page-heading history-heading">
        <div>
          <span className="eyebrow">Longitudinal quality</span>
          <h1>Trend Explorer</h1>
          <p>
            Follow a skill through branch updates. Select an execution to
            inspect its results and test changes.
          </p>
        </div>
        <div className="type-switch">
          <button onClick={onShowE2E}>E2E history</button>
          <button className="active" aria-pressed="true">
            Unit skill history
          </button>
        </div>
      </div>
      <section
        className={`panel ${styles.controls}`}
        aria-label="History scope"
      >
        <label>
          <span>Skill / repository</span>
          <select
            aria-label="History skill"
            value={skill ? skillScopeKey(skill) : ""}
            disabled={!skills.length}
            onChange={(event) => {
              setSkillChoice(event.target.value);
              setStageChoice("all");
              setTargetChoice("all");
              resetCohort();
            }}
          >
            {skills.map((item) => (
              <option key={skillScopeKey(item)} value={skillScopeKey(item)}>
                {item.skill} ·{" "}
                {item.githubRepository ?? "Repository not recorded"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Stage</span>
          <select
            aria-label="History stage"
            value={stage ?? ""}
            disabled={!stages.length}
            onChange={(event) => {
              setStageChoice(event.target.value);
              setTargetChoice("all");
              resetCohort();
            }}
          >
            <option value="all">All stages</option>
            {stages.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Target</span>
          <select
            aria-label="History target"
            value={targetChoice === "all" ? "all" : (scope?.scopeKey ?? "")}
            disabled={!targets.length}
            onChange={(event) => {
              setTargetChoice(event.target.value);
              resetCohort();
            }}
          >
            <option value="all">All targets</option>
            {targets.map((item) => (
              <option key={item.scopeKey} value={item.scopeKey}>
                {item.targetEnvironment ?? "Target not recorded"} ·{" "}
                {item.environment}
                {stage === "all" ? ` · ${item.stage}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="range-switch" aria-label="History time window">
          {(["7d", "30d", "90d"] as const).map((value) => (
            <button
              key={value}
              className={range === value ? "active" : ""}
              aria-pressed={range === value}
              onClick={() => {
                setRange(value);
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <button className="secondary-button" onClick={refreshHistory}>
          ↻ Refresh
        </button>
      </section>
      {catalog.error && (
        <div className="toast toast--error" role="alert">
          {catalog.error}
          <button onClick={refreshHistory}>Retry</button>
        </div>
      )}
      {!catalog.loaded && (
        <section className="panel empty" role="status">
          Loading recorded skills, stages, and targets…
        </section>
      )}
      {catalog.loaded && !catalog.error && !scope && (
        <section className="panel empty">
          No recorded unit evaluation scopes are available.
        </section>
      )}
      {loading && (
        <section className="panel empty" role="status">
          Loading every execution in the selected window…
        </section>
      )}
      {error && (
        <div className="toast toast--error" role="alert">
          {error}
          <button onClick={refreshHistory}>Retry</button>
        </div>
      )}
      {data && (
        <>
          <div className={styles.contextLine}>
            <span>
              {data.branches.length} branches · {data.runs.length} executions ·{" "}
              {historyTime(data.startedFrom)}–{historyTime(data.startedBefore)}
            </span>
            {!!settingsGroups.length && (
              <label>
                Settings{" "}
                <select
                  aria-label="History analysis configuration"
                  value={cohortChoice.key}
                  onChange={(event) =>
                    setCohortChoice({
                      key: event.target.value,
                      scopeKey: scope?.scopeKey ?? "",
                      revision,
                    })
                  }
                >
                  <option value="">All settings · BSA, skill & agent</option>
                  {cohortChoice.key &&
                    !settingsGroups.some(
                      (item) => item.key === cohortChoice.key,
                    ) && (
                      <option value={cohortChoice.key}>
                        Selected settings · no runs in this window
                      </option>
                    )}
                  {settingsGroups.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {data.cohorts.length > 1 && (
            <details className={styles.analysisDetails}>
              <summary>Recorded evaluation settings</summary>
              <ul>
                {data.cohorts
                  .filter(
                    (item) =>
                      !cohortChoice.key ||
                      Boolean(selectedSettings?.cohortKeys.includes(item.key)),
                  )
                  .map((item) => (
                    <li key={item.key}>
                      <strong>{item.label}</strong>
                      <ul>
                        {item.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <UnitTrendExplorerContent
            key={requestKey}
            chartRunIds={
              cohortChoice.key ? (selectedSettings?.runIds ?? []) : null
            }
            api={api}
            data={data}
            {...navigation}
          />
        </>
      )}
    </div>
  );
}

