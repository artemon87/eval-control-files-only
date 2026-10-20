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
  assert.match(pageSource, /aria-label="Target environments"/);
  assert.match(pageSource, /function TargetComparisonChart/);
  assert.match(pageSource, /targetEnvironments\.includes\(point\.targetEnvironment\)/);
  assert.match(cssSource, /\.target-chip\.selected/);
  assert.match(cssSource, /\.target-comparison-line/);
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
  assert.match(pageSource, /setTargetEnvironments\(isolated \? \[\] : \[summary\.targetId\]\)/);
  assert.match(pageSource, /summary\.latest\.passRatePct/);
  assert.match(pageSource, /summary\.latest\.meanScore/);
  assert.match(pageSource, /summary\.passDelta/);
  assert.match(cssSource, /\.unit-target-summary-card\.selected/);
});
