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

test("overview separates blocked runs from other actionable runs", () => {
  assert.match(pageSource, /function isBlockedRun\(run: EvalRun\)/);
  assert.match(pageSource, /function isNeedsAttentionRun\(run: EvalRun\)/);
  assert.match(pageSource, /!isBlockedRun\(run\)/);
  assert.match(pageSource, /run\.executionStatus === "error"/);
  assert.match(pageSource, /run\.verdict === "failed"/);
  assert.match(pageSource, /run\.verdict === "xpassed"/);
  assert.match(pageSource, /isDegradedRun\(run\)/);
});

test("overview renders a compact two-tab inbox with independent counts", () => {
  assert.match(pageSource, /overviewInboxTab/);
  assert.match(pageSource, />\s*Blocked\s*<b>\{overview\.blockedRuns\.length\}<\/b>/);
  assert.match(
    pageSource,
    />\s*Needs attention\s*<b>\{overview\.attentionRuns\.length\}<\/b>/,
  );
  assert.match(pageSource, /label="Actionable runs"/);
  assert.match(cssSource, /\.attention-tabs/);
});

test("degraded E2E thresholds support ratios and percentages", () => {
  assert.match(pageSource, /threshold <= 1 \? threshold \* 100 : threshold/);
  assert.match(
    pageSource,
    /run\.summary\.passRatePct < threshold/,
  );
});
