import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pageSource, apiSource, cssSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/eval-api.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("unit metadata is filterable and visible without hiding legacy runs", () => {
  for (const label of ["Category", "Target environment", "Agent"]) {
    assert.match(pageSource, new RegExp(`>${label}<`));
  }
  assert.match(apiSource, /params\.set\("category", filters\.category\)/);
  assert.match(
    apiSource,
    /params\.set\("target_environment", filters\.targetEnvironment\)/,
  );
  assert.match(apiSource, /params\.set\("agent_name", filters\.agentName\)/);
  assert.match(pageSource, /"Uncategorized"/);
  assert.match(pageSource, /"Target not recorded"/);
  assert.match(pageSource, /"Agent not recorded"/);
});

test("unit metadata filters preserve repository, branch, and SHA scoping", () => {
  assert.match(pageSource, /githubRepository: repositoryFilter\.trim\(\)/);
  assert.match(pageSource, /gitRef: branchFilter\.trim\(\)/);
  assert.match(pageSource, /gitSha: shaFilter\.trim\(\)/);
  for (const label of ["Repository", "Branch", "Commit SHA"]) {
    assert.match(pageSource, new RegExp(`>${label}<`));
  }
  assert.match(apiSource, /params\.set\("github_repository"/);
  assert.match(apiSource, /params\.set\("git_ref"/);
  assert.match(apiSource, /params\.set\("git_sha"/);
});

test("run history supports category scoping and multi-target comparison", () => {
  assert.match(pageSource, /aria-label="History category"/);
  assert.match(pageSource, /aria-label="History target environment"/);
  assert.match(pageSource, /function TargetComparisonChart/);
  assert.match(pageSource, /targetEnvironments\.includes\(point\.targetEnvironment\)/);
  assert.match(pageSource, /All targets/);
  assert.match(cssSource, /\.target-comparison-line/);
});

test("runs separate evaluation scope filters from the grouping lens", () => {
  assert.match(pageSource, /className="run-scope-filters"/);
  assert.match(pageSource, /All skills in \$\{category\}/);
  assert.match(pageSource, /className="run-grouping-lens"/);
  assert.match(pageSource, /Skill → target/);
  assert.match(pageSource, /Target → skill/);
  assert.match(pageSource, /Attention/);
  assert.match(pageSource, /Flat table/);
  assert.match(pageSource, /function RunGroups/);
  assert.match(pageSource, /sortOrder: RunSortOrder/);
  assert.match(pageSource, /sortOrder=\{sortOrder\}/);
  assert.match(pageSource, /const displayedRuns = subgroupRuns\.slice\(0, 6\)/);
  assert.match(pageSource, /\{displayedRuns\.map\(\(run\) => \(/);
  assert.match(
    pageSource,
    /const latest = \[\.\.\.subgroupRuns\]\.sort\(\(left, right\) =>/,
  );
  assert.match(pageSource, /className="run-group-list"/);
  assert.match(cssSource, /\.run-group-metrics/);
  assert.match(cssSource, /\.run-sequence-mark--failed/);
});

test("run grouping never treats a unit skill as its target environment", () => {
  assert.match(pageSource, /function recordedRunTarget/);
  assert.match(pageSource, /if \(run\.evalType === "unit"\)/);
  assert.match(
    pageSource,
    /run\.unitConfig\?\.targetEnvironment\?\.trim\(\) \|\| null/,
  );
  assert.match(
    pageSource,
    /recordedRunTarget\(run\) \?\? "Target not recorded"/,
  );
  assert.doesNotMatch(
    pageSource,
    /run\.unitConfig\?\.targetEnvironment \?\?\s*run\.target/,
  );
  assert.match(pageSource, /const recordedCoverage = new Set/);
  assert.match(pageSource, /const missingTargetCount = runs\.filter/);
  assert.match(pageSource, /recorded skill × target combinations/);
});

test("select controls use one cross-browser chevron inset", () => {
  assert.match(cssSource, /select:not\(\[multiple\]\)/);
  assert.match(cssSource, /-webkit-appearance: none/);
  assert.match(cssSource, /background-position: right 12px center/);
});

test("unit history provides a clickable category health matrix", () => {
  assert.match(pageSource, /All skills · category matrix/);
  assert.match(pageSource, /className="unit-health-matrix"/);
  assert.match(pageSource, /matrixLatestByScope/);
  assert.match(pageSource, /setSkillId\(matrixSkillId\)/);
  assert.match(pageSource, /setTargetEnvironments\(\[targetId\]\)/);
  assert.match(pageSource, /Mean not recorded/);
  assert.match(pageSource, /unit-health-axis-button--target/);
  assert.match(pageSource, /unit-health-axis-button--skill/);
  assert.match(pageSource, /unit-health-skill-column-heading/);
  assert.match(cssSource, /\.unit-health-skill-column-heading/);
  assert.match(cssSource, /\.unit-health-axis-button--skill/);
  assert.match(cssSource, /min-height: 72px/);
  assert.match(cssSource, /\.unit-health-cell\.passing/);
  assert.match(cssSource, /\.unit-health-cell\.failing/);
});

test("run ordering offers quality and chronological choices", () => {
  for (const label of [
    "Newest first",
    "Oldest first",
    "Highest pass rate",
    "Lowest pass rate",
    "Highest mean score",
    "Lowest mean score",
  ]) {
    assert.match(pageSource, new RegExp(label));
  }
});


test("advanced run requirements filter configured and observed quality", () => {
  for (const label of [
    "Configured gate at least",
    "Observed pass rate at least",
    "Mean score at least",
  ]) {
    assert.match(pageSource, new RegExp(label));
  }
  assert.match(pageSource, /configuredGatePct >= Number\(minimumGateThreshold\)/);
  assert.match(pageSource, /run\.summary\.passRatePct >= Number\(minimumPassRate\)/);
  assert.match(pageSource, /run\.summary\.meanScore >= Number\(minimumMeanScore\)/);
  assert.match(pageSource, /aria-label="Active score requirements"/);
  assert.match(cssSource, /\.active-requirement-chips/);
});

test("unit history renders clickable per-target summaries", () => {
  assert.match(pageSource, /unitTargetSummaries/);
  assert.match(pageSource, /className="unit-target-summary-grid"/);
  assert.match(
    pageSource,
    /setTargetEnvironments\(\s*isolated \? \[\] : \[summary\.targetId\]/,
  );
  assert.match(pageSource, /summary\.latest\.passRatePct/);
  assert.match(pageSource, /summary\.latest\.meanScore/);
  assert.match(pageSource, /summary\.passDelta/);
  assert.match(
    pageSource,
    /target-dot target-dot--\$\{summary\.latest\.verdict\}/,
  );
  for (const verdict of ["passed", "failed", "blocked", "xpassed"]) {
    assert.match(cssSource, new RegExp("\\.target-dot--" + verdict));
  }
  assert.match(cssSource, /\.unit-target-summary-card\.selected/);
});


test("run filters restore category-scoped skill selection", () => {
  assert.match(pageSource, /<span>Skill<\/span>/);
  assert.match(pageSource, /filterOptions\.skills\.map/);
  assert.match(pageSource, /skill: skillFilter === "all"/);
  assert.match(pageSource, /setSkillFilter\("all"\)/);
  assert.match(apiSource, /params\.set\("skill", filters\.skill\)/);
});

test("quality filters distinguish missing data from real zero scores", () => {
  assert.match(apiSource, /mean_scores\?:/);
  assert.match(apiSource, /function summaryMeanScore/);
  assert.match(apiSource, /meanScoreRecorded: meanScore !== undefined/);
  assert.match(pageSource, /No recorded gate thresholds/);
  assert.match(pageSource, /No recorded mean scores/);
  assert.match(pageSource, /run\.summary\.meanScoreRecorded/);
  assert.match(cssSource, /\.advanced-filters select:disabled/);
});

test("grouped runs expose selectable lazy metric matrices without stealing run clicks", () => {
  assert.match(pageSource, /function MetricMultiSelect/);
  assert.match(pageSource, /Visible metrics/);
  assert.match(pageSource, /Add metric/);
  assert.match(pageSource, /run-visible-metric-chip/);
  assert.match(pageSource, /type="checkbox"/);
  assert.match(pageSource, /Select all/);
  assert.match(pageSource, /Clear/);
  assert.match(pageSource, />\s*Done\s*</);
  assert.match(pageSource, /document\.addEventListener\("pointerdown"/);
  assert.match(pageSource, /event\.key !== "Escape"/);
  assert.match(pageSource, /disabled=\{!selectedMetrics\.length\}/);
  assert.match(pageSource, /const displayedRuns = subgroupRuns\.slice\(0, 6\)/);
  assert.match(pageSource, /const matrixRuns = displayedRuns/);
  assert.match(
    pageSource,
    /repeat\(6, minmax\(86px, 1fr\)\)/,
    "metric cells should stay on the same left-aligned six-run track when fewer than six runs are present",
  );
  assert.match(pageSource, /toggleMetricRow\(rowKey, displayedRuns\)/);
  assert.match(pageSource, /\.slice\(0, 6\)/);
  assert.match(pageSource, /Metric \/ threshold/);
  assert.match(pageSource, /run-metric-cell--latest/);
  assert.match(pageSource, /await api\.listCases\(run\)/);
  assert.match(pageSource, /onClick=\{\(\) => onOpen\(run\)\}/);
  assert.match(pageSource, /runMetricSummary/);
  assert.match(apiSource, /metricMeans: summaryMetricMeans\(value\)/);
  assert.match(apiSource, /mean_scores\?:/);
  assert.match(cssSource, /\.run-visible-metrics/);
  assert.match(cssSource, /\.run-metric-cell--passed/);
  assert.match(cssSource, /\.run-metric-cell--failed/);
});
