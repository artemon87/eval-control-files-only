import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("supports normalized blocked and XPASS verdicts", async () => {
  const [api, page, types] = await Promise.all([
    readFile(new URL("../app/lib/eval-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/eval-types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(types, /"xpassed"/);
  assert.match(api, /case "error":\s*return "blocked"/);
  assert.match(api, /case "xpassed":/);
  assert.match(page, /effectiveRunVerdict\(run\) === verdict/);
  assert.match(page, /<option value="xpassed">XPASS<\/option>/);
});

test("exposes schema-backed advanced run filters", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  for (const label of ["Execution status", "Stage / environment", "Trigger", "Actor", "Started"]) {
    assert.match(page, new RegExp(`>${label}<`));
  }
  assert.match(page, /Clear advanced filters/);
});

test("loads isolated skill and case trends on demand", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/eval-api.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /View this case over time/);
  assert.match(page, /View trend/);
  assert.match(page, /api\.listTrend\(request, null, 30/);
  assert.match(api, /\/e2e\/trends\/cases/);
  assert.match(api, /\/e2e\/trends\/suites/);
  assert.match(api, /\/unit\/trends\/cases/);
  assert.match(api, /\/unit\/trends\/skills/);
});

test("never substitutes operational demo data", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(page, /demoDrilldownTrend|eval-data|eval-history|deterministic demo/i);
  assert.doesNotMatch(page, /RecordExample|e2e-97a0f7b810|unit-fc82d1a640/);
  assert.match(page, /setRuns\(\[\]\)/);
  assert.match(page, /no dashboard data is being substituted/);
  await assert.rejects(readFile(new URL("../app/lib/eval-data.ts", import.meta.url), "utf8"));
  await assert.rejects(readFile(new URL("../app/lib/eval-history.ts", import.meta.url), "utf8"));
});
