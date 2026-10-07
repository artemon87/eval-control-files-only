import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const admin = await readFile(
  new URL("../app/admin/access/access-admin-client.tsx", import.meta.url),
  "utf8",
);
const adminPage = await readFile(
  new URL("../app/admin/access/page.tsx", import.meta.url),
  "utf8",
);
const getAccess = await readFile(
  new URL("../app/get-access/get-access-client.tsx", import.meta.url),
  "utf8",
);
const getAccessPage = await readFile(
  new URL("../app/get-access/page.tsx", import.meta.url),
  "utf8",
);

test("both access pages require an authenticated session", () => {
  for (const source of [adminPage, getAccessPage]) {
    assert.match(source, /const session = await auth\(\)/);
    assert.match(source, /redirect\("\/sign-in"\)/);
  }
  assert.doesNotMatch(adminPage, /session\.user\.role/);
});

test("Get Access supports Editor and Admin requests with a business reason", () => {
  assert.match(getAccess, /editor:/);
  assert.match(getAccess, /admin:/);
  assert.match(getAccess, /Business reason/);
  assert.match(getAccess, /minLength=\{10\}/);
  assert.match(getAccess, /createAccessRequest\(requestedRole, reason\.trim\(\)\)/);
  assert.match(getAccess, /cancelAccessRequest\(requestId\)/);
  assert.match(getAccess, /request\.status === "pending"/);
  assert.match(getAccess, /Approved access is granted directly by EvalHub/);
});

test("Get Access handles loading, aborts and API failures", () => {
  assert.match(getAccess, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(getAccess, /const controller = new AbortController\(\)/);
  assert.match(getAccess, /return \(\) => controller\.abort\(\)/);
  assert.match(getAccess, /error instanceof AccessApiError/);
  assert.match(getAccess, /role="alert"/);
  assert.match(getAccess, /role="status"/);
  assert.doesNotMatch(
    getAccess,
    /const loadRequests = useCallback\(async \(signal\?: AbortSignal\) => \{\s*setLoading\(true\)/,
  );
});

test("Access Management exposes users, requests, assignments and audit", () => {
  for (const label of [
    "Known EvalHub users",
    "EvalHub access requests",
    "Role assignments",
    "Authorization audit",
  ]) {
    assert.match(admin, new RegExp(label));
  }
  assert.match(admin, /type Tab = "users" \| "requests" \| "assignments" \| "audit"/);
  assert.doesNotMatch(admin, /NEXT_PUBLIC_ENTRA_ENTERPRISE_APP_URL/);
  assert.match(admin, /EvalHub is the authorization source of truth/);
});

test("administrators can approve or reject local EvalHub access", () => {
  assert.match(admin, /onDecision\(request, "approve"\)/);
  assert.match(admin, /onDecision\(request, "reject"\)/);
  assert.doesNotMatch(admin, /onDecision\(request, "fulfill"\)/);
  assert.match(admin, /Approval grants this EvalHub role immediately/);
  assert.doesNotMatch(admin, /assignEntraRole|grantEntraRole|graph\.microsoft/);
});

test("role assignment is local and prevents self-management", () => {
  assert.doesNotMatch(admin, /entra_roles_last_seen|EvalHub\.Admin/);
  assert.match(admin, /user\.principal_id !== currentPrincipalId/);
  assert.match(admin, /local_role: role/);
  assert.match(admin, /scope: \{ type: "global", id: "\*" \}/);
  assert.match(admin, /No Entra app role is required/);
});
