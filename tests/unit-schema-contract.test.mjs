import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(
  new URL("../app/lib/eval-api.ts", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const types = await readFile(
  new URL("../app/lib/eval-types.ts", import.meta.url),
  "utf8",
);

test("maps nullable unit config, timing, explanations, and multi-turn evidence", () => {
  assert.match(api, /skill_version\?\:/);
  assert.match(api, /turns\?\:/);
  assert.match(api, /score_explanations\?\:/);
  assert.match(api, /thresholds\?\:/);
  assert.match(api, /duration_ms\?\:/);
  assert.match(api, /item\.turns\?\.map/);
  assert.match(types, /export interface EvalTurn/);
  assert.match(types, /thresholds\?: Record<string, number>/);
  assert.match(page, /function TurnTimeline/);
  assert.match(page, /function ScoreBreakdown/);
  assert.match(page, /function MetricGateTags/);
  assert.match(page, /score >= threshold/);
  assert.match(page, /MetricGateTags/);
});
