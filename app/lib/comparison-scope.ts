import type { EvalRun } from "./eval-types";

export function unitStage(run: EvalRun): string {
  return run.unitConfig?.stage?.trim() || run.stage || "Stage not recorded";
}

export function unitTargetKey(run: EvalRun): string {
  // Keep missing metadata isolated; never silently treat it as a known target.
  return JSON.stringify([
    run.unitConfig?.targetEnvironment?.trim() || null,
    run.environment || run.unitConfig?.bsaEnvironment || null,
  ]);
}

export function unitTargetLabel(key: string): string {
  const [target, environment] = JSON.parse(key) as [
    string | null,
    string | null,
  ];
  return `${target ?? "Target not recorded"} · ${environment ?? "Environment not recorded"}`;
}

export function unitScopeLabel(run: EvalRun): string {
  return `${unitStage(run)} · ${unitTargetLabel(unitTargetKey(run))} · ${run.unitConfig?.category || "Uncategorized"}`;
}

export function selectUnitRuns(
  runs: EvalRun[],
  skill: string,
  repository: string | null,
  stage?: string,
  targetKey?: string,
  category?: string,
): EvalRun[] {
  return runs
    .filter(
      (run) =>
        run.evalType === "unit" &&
        run.executionStatus === "completed" &&
        (run.unitConfig?.skillId ?? run.target) === skill &&
        (run.githubRepository ?? null) === repository &&
        (!stage || unitStage(run) === stage) &&
        (!targetKey || unitTargetKey(run) === targetKey) &&
        (!category ||
          (run.unitConfig?.category || "Uncategorized") === category),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// Resolve each side independently; a stage change cannot retain an invalid target.
export function unitComparisonSide(
  runs: EvalRun[],
  stage: string,
  target: string,
) {
  const stages = [...new Set(runs.map(unitStage))].sort();
  const selectedStage = stages.includes(stage) ? stage : (stages[0] ?? "");
  const stageRuns = runs.filter((run) => unitStage(run) === selectedStage);
  const targets = [...new Set(stageRuns.map(unitTargetKey))].sort((a, b) =>
    unitTargetLabel(a).localeCompare(unitTargetLabel(b)),
  );
  const selectedTarget = targets.includes(target) ? target : (targets[0] ?? "");
  return {
    stages,
    targets,
    stage: selectedStage,
    target: selectedTarget,
    runs: stageRuns.filter((run) => unitTargetKey(run) === selectedTarget),
  };
}
