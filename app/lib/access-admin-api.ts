import type {
  AccessUser,
  AccessRequestAction,
  AccessRequestRecord,
  AccessRequestStatus,
  AssignmentCreate,
  AssignmentRecord,
  AuditEvent,
  AuthorizationContext,
  EvalHubRole,
  Page,
} from "./access-admin-types";

const API_ROOT = "/api/eval/admin/access";
const EVAL_API_ROOT = "/api/eval";
const ACCESS_REQUEST_ROOT = "/api/eval/access-requests";

export class AccessApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AccessApiError";
  }
}

export function getMyAuthorization(signal?: AbortSignal): Promise<AuthorizationContext> {
  return request<AuthorizationContext>("/auth/me", { signal }, EVAL_API_ROOT);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  apiRoot = API_ROOT,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Request-ID", crypto.randomUUID());
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new AccessApiError(
      body?.detail ?? `Access API returned ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function listAccessUsers(
  search: string,
  signal?: AbortSignal,
): Promise<Page<AccessUser>> {
  const params = new URLSearchParams({ limit: "100", offset: "0" });
  if (search.trim()) {
    params.set("search", search.trim());
  }
  return request<Page<AccessUser>>(`/users?${params}`, { signal });
}

export function listAssignments(
  activeOnly: boolean,
  signal?: AbortSignal,
): Promise<Page<AssignmentRecord>> {
  const params = new URLSearchParams({
    active_only: String(activeOnly),
    limit: "100",
    offset: "0",
  });
  return request<Page<AssignmentRecord>>(`/assignments?${params}`, { signal });
}

export function listAuditEvents(signal?: AbortSignal): Promise<Page<AuditEvent>> {
  return request<Page<AuditEvent>>("/audit?limit=100&offset=0", { signal });
}

export function createAssignment(
  payload: AssignmentCreate,
): Promise<AssignmentRecord> {
  return request<AssignmentRecord>("/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeAssignment(
  assignmentId: string,
  reason: string,
): Promise<AssignmentRecord> {
  return request<AssignmentRecord>(
    `/assignments/${encodeURIComponent(assignmentId)}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

export function createAccessRequest(
  requestedRole: EvalHubRole,
  businessReason: string,
): Promise<AccessRequestRecord> {
  return request<AccessRequestRecord>(
    "",
    {
      method: "POST",
      body: JSON.stringify({
        requested_role: requestedRole,
        business_reason: businessReason,
      }),
    },
    ACCESS_REQUEST_ROOT,
  );
}

export function listMyAccessRequests(
  signal?: AbortSignal,
): Promise<Page<AccessRequestRecord>> {
  return request<Page<AccessRequestRecord>>(
    "/me?limit=50&offset=0",
    { signal },
    ACCESS_REQUEST_ROOT,
  );
}

export function cancelAccessRequest(
  accessRequestId: string,
): Promise<AccessRequestRecord> {
  return request<AccessRequestRecord>(
    `/${encodeURIComponent(accessRequestId)}/cancel`,
    { method: "POST" },
    ACCESS_REQUEST_ROOT,
  );
}

export function listAdminAccessRequests(
  status?: AccessRequestStatus,
  signal?: AbortSignal,
): Promise<Page<AccessRequestRecord>> {
  const params = new URLSearchParams({ limit: "100", offset: "0" });
  if (status) params.set("request_status", status);
  return request<Page<AccessRequestRecord>>(`/requests?${params}`, { signal });
}

export function decideAccessRequest(
  accessRequestId: string,
  action: AccessRequestAction,
  note: string,
): Promise<AccessRequestRecord> {
  return request<AccessRequestRecord>(
    `/requests/${encodeURIComponent(accessRequestId)}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ action, note }),
    },
  );
}
