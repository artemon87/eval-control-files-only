import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(
  new URL("../app/lib/access-admin-api.ts", import.meta.url),
  "utf8",
);
const types = await readFile(
  new URL("../app/lib/access-admin-types.ts", import.meta.url),
  "utf8",
);
const provider = await readFile(
  new URL("../app/components/authorization-provider.tsx", import.meta.url),
  "utf8",
);

test("authorization types keep Entra as product-role authority", () => {
  assert.match(types, /type EntraRole = "EvalHub\.Viewer" \| "EvalHub\.Editor" \| "EvalHub\.Admin"/);
  assert.match(types, /type PlatformRole = "platform_admin"/);
  assert.doesNotMatch(types, /evaluation_admin|moderator/);
  assert.match(types, /"pending"/);
  assert.match(types, /"approved"/);
  assert.match(types, /"fulfilled"/);
  assert.match(types, /"rejected"/);
  assert.match(types, /"cancelled"/);
});

test("API client uses gateway-safe routes and secure request defaults", () => {
  assert.match(api, /const API_ROOT = "\/api\/eval\/admin\/access"/);
  assert.match(api, /const EVAL_API_ROOT = "\/api\/eval"/);
  assert.match(api, /const ACCESS_REQUEST_ROOT = "\/api\/eval\/access-requests"/);
  assert.doesNotMatch(api, /\/api\/eval\/v1/);
  assert.match(api, /credentials: "same-origin"/);
  assert.match(api, /cache: "no-store"/);
  assert.match(api, /headers\.set\("X-Request-ID", crypto\.randomUUID\(\)\)/);
  assert.match(api, /class AccessApiError extends Error/);
});

test("API client exposes the complete assignment and request workflow", () => {
  for (const functionName of [
    "getMyAuthorization",
    "listAccessUsers",
    "listAssignments",
    "listAuditEvents",
    "createAssignment",
    "revokeAssignment",
    "createAccessRequest",
    "listMyAccessRequests",
    "cancelAccessRequest",
    "listAdminAccessRequests",
    "decideAccessRequest",
  ]) {
    assert.match(api, new RegExp(`export function ${functionName}\\(`));
  }
  assert.match(api, /requested_role: requestedRole/);
  assert.match(api, /business_reason: businessReason/);
  assert.match(api, /body: JSON\.stringify\(\{ action, note \}\)/);
});

test("authorization provider aborts stale calls and avoids synchronous effect state", () => {
  assert.match(provider, /const controller = new AbortController\(\)/);
  assert.match(provider, /return \(\) => controller\.abort\(\)/);
  assert.match(provider, /resolved\?\.sessionKey === sessionKey/);
  assert.match(provider, /status === "authenticated"/);
  assert.doesNotMatch(provider, /setLoading\(/);
  assert.doesNotMatch(provider, /setAuthorization\(/);
  assert.match(provider, /permissionSet\.has\(permission\)/);
});
