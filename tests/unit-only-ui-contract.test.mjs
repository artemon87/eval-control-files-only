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

test("unit cases do not map tier while e2e cases retain it", () => {
  const unitCase = api.slice(
    api.indexOf("interface UnitApiCase"),
    api.indexOf("interface E2EApiCase"),
  );
  const e2eCase = api.slice(
    api.indexOf("interface E2EApiCase"),
    api.indexOf("interface ApiTrendPoint"),
  );

  assert.doesNotMatch(unitCase, /tier\??:/);
  assert.match(e2eCase, /tier\??:/);
  assert.match(page, /run\.evalType === "e2e" && \(/);
});

test("unit summary renders a zero pass rate and derives mean score", () => {
  assert.match(page, /run\.summary\.passRatePct\.toFixed/);
  assert.match(page, /const unitMetricValues = scopedCases\.flatMap/);
  assert.match(page, /unitMeanScore\.toFixed\(2\)/);
});

test("unit evidence always renders expected and predicted trajectories", () => {
  assert.match(page, /title="Expected trajectory"/);
  assert.match(page, /title="Predicted trajectory"/);
  assert.match(page, /item\.predictedTrajectory == null/);
  assert.match(page, /"Not recorded"/);
});

test("unit test and metric trends are wired independently", () => {
  assert.match(api, /kind: "skill" \| "case" \| "metric"/);
  assert.match(api, /params\.set\("metric", query\.metric\)/);
  assert.match(page, /Test trend/);
  assert.match(page, /Metric trend/);
  assert.match(page, /run\.evalType === "unit" \? "metric" : "skill"/);
});
