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
