import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pageSource, apiSource, windowSource] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/eval-api.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/time-window.ts", import.meta.url), "utf8"),
]);

test("run timeframes are fixed once and sent to the backend", () => {
  assert.match(pageSource, /fixedTimeWindow\(startedWithin\)/);
  assert.match(pageSource, /startedFrom: runTimeWindow\?\.startedFrom/);
  assert.match(pageSource, /startedBefore: runTimeWindow\?\.startedBefore/);
  assert.match(pageSource, /<option value="90d">Last 90 days<\/option>/);
  assert.match(apiSource, /params\.set\("started_from", filters\.startedFrom\)/);
  assert.match(apiSource, /params\.set\("started_before", filters\.startedBefore\)/);
});

test("time windows use stable half-open UTC boundaries", () => {
  assert.match(windowSource, /startedFrom: new Date/);
  assert.match(windowSource, /startedBefore: now\.toISOString\(\)/);
  assert.match(windowSource, /"90d": 90 \* 24/);
});
