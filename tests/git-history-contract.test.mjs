import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const cssSource = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("history exposes filtered verdict counts and GitHub metadata", () => {
  for (const label of [
    "Passed runs",
    "Failed runs",
    "Blocked runs",
    "XPASS runs",
  ]) {
    assert.match(pageSource, new RegExp(label));
  }
  assert.match(pageSource, /GitHub run \{point\.githubRunId\}/);
  assert.doesNotMatch(pageSource, /<small>batch \{point\.batchId\}<\/small>/);
});

test("run details expose case outcomes and complete Git context", () => {
  assert.match(pageSource, /className="case-outcome-grid"/);
  assert.match(pageSource, /<small>Git SHA<\/small>/);
  assert.match(pageSource, /<small>Repository<\/small>/);
  assert.match(pageSource, /<small>GitHub run<\/small>/);
  assert.match(cssSource, /\.case-outcome--xpassed/);
});

test("comparison labels include the selected Git SHA", () => {
  assert.match(pageSource, /SHA \$\{shortGitSha\(run\.gitSha\)\}/);
  assert.match(pageSource, /shortGitSha\(baseline\.gitSha\)/);
  assert.match(pageSource, /shortGitSha\(candidate\.gitSha\)/);
});
