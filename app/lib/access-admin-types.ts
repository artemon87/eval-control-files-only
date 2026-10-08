export type EvalHubRole = "editor" | "admin";
export type Permission =
  | "evals.annotate"
  | "evals.edit"
  | "suggestions.moderate"
  | "access.manage"
  | "audit.read";
export type ResourceType = "evaluation" | "suggestion" | "access" | "audit";
export type ScopeType = "global" | "resource";
export type EvaluationType = "unit" | "e2e";
export type AssignmentStatus = "active" | "expired" | "revoked";
export type AccessRequestStatus =
  | "pending"
  | "approved"
  | "fulfilled"
  | "rejected"
  | "cancelled";
export type AccessRequestAction = "approve" | "reject";

export interface AuthorizationScope {
  type: ScopeType;
  resource: ResourceType | null;
  constraints: Record<string, string[]>;
}

export interface ActorReference {
  tenant_id: string;
  principal_id: string;
  display_name?: string | null;
}

export interface AssignmentRecord {
  _id: string;
  tenant_id: string;
  principal_id: string;
  local_role: EvalHubRole;
  scope: AuthorizationScope;
  status: AssignmentStatus;
  reason: string;
  granted_by: ActorReference;
  created_at: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  revoked_by?: ActorReference | null;
  revocation_reason?: string | null;
}

export interface AccessUser {
  tenant_id: string;
  principal_id: string;
  display_name: string;
  email?: string | null;
  roles: EvalHubRole[];
  assignments: AssignmentRecord[];
  effective_permissions: Permission[];
  last_login_at: string;
}

export interface AccessRequestRecord {
  _id: string;
  tenant_id: string;
  principal_id: string;
  display_name: string;
  email?: string | null;
  requested_role: EvalHubRole;
  business_reason: string;
  status: AccessRequestStatus;
  created_at: string;
  updated_at: string;
  decided_at?: string | null;
  decided_by?: ActorReference | null;
  decision_note?: string | null;
  fulfilled_at?: string | null;
}

export interface AuditEvent {
  _id: string;
  event_type: string;
  actor: ActorReference;
  target: ActorReference;
  assignment_id?: string | null;
  access_request_id?: string | null;
  local_role?: EvalHubRole | null;
  requested_role?: EvalHubRole | null;
  scope?: AuthorizationScope | null;
  reason: string;
  occurred_at: string;
  request_id?: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AssignmentCreate {
  tenant_id: string;
  principal_id: string;
  local_role: EvalHubRole;
  scope: AuthorizationScope;
  reason: string;
  expires_at?: string | null;
}

export interface AuthorizationContext {
  tenant_id: string;
  principal_id: string;
  roles: EvalHubRole[];
  permissions: Permission[];
}
