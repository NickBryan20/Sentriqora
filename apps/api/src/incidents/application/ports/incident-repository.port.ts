import type {
  EventSeverityValue,
  EvidenceStatusValue,
  IncidentPriorityValue,
  IncidentStatusValue,
} from '@aegisflow/contracts';

export const INCIDENT_REPOSITORY_PORT = Symbol('INCIDENT_REPOSITORY_PORT');

export interface IncidentCursor {
  id: string;
  updatedAt: Date;
}

export interface IncidentSummary {
  alertCount: number;
  assignedMembership: { displayName: string; id: string } | null;
  createdAt: string;
  firstDetectedAt: string;
  id: string;
  key: string;
  primaryAsset: { id: string; key: string; name: string } | null;
  priority: IncidentPriorityValue;
  resolutionDueAt: string;
  responseDueAt: string;
  riskScore: number;
  severity: EventSeverityValue;
  sla: { resolutionBreached: boolean; responseBreached: boolean };
  status: IncidentStatusValue;
  title: string;
  updatedAt: string;
  version: number;
}

export interface IncidentEvidenceValue {
  contentType: string;
  createdAt: string;
  fileName: string;
  id: string;
  objectKey: string;
  rejectionReason: string | null;
  sha256: string;
  sizeBytes: number;
  status: EvidenceStatusValue;
  version: number;
}

export type MutationResult<T> =
  { kind: 'conflict' } | { kind: 'not_found' } | { kind: 'success'; value: T };

export interface IdempotencyContext {
  actorUserId: string;
  keyHash: string;
  requestHash: string;
  scope: string;
}

export interface IncidentRepositoryPort {
  addComment(input: {
    body: string;
    idempotency: IdempotencyContext;
    incidentId: string;
    organizationId: string;
    userId: string;
  }): Promise<{ replayed: boolean; value: unknown }>;
  assign(input: {
    assignedMembershipId: string | null;
    incidentId: string;
    organizationId: string;
    userId: string;
    version: number;
  }): Promise<MutationResult<IncidentSummary>>;
  beginEvidenceInspection(input: {
    evidenceId: string;
    incidentId: string;
    organizationId: string;
    userId: string;
    version: number;
  }): Promise<MutationResult<IncidentEvidenceValue>>;
  createEvidence(input: {
    contentType: string;
    evidenceId: string;
    fileName: string;
    idempotency: IdempotencyContext;
    incidentId: string;
    objectKey: string;
    organizationId: string;
    sha256: string;
    sizeBytes: number;
    userId: string;
  }): Promise<{ replayed: boolean; value: IncidentEvidenceValue }>;
  createIncident(input: {
    alertIds: string[];
    description: string;
    idempotency: IdempotencyContext;
    organizationId: string;
    severity?: EventSeverityValue;
    title: string;
    userId: string;
  }): Promise<{ replayed: boolean; value: IncidentSummary }>;
  finalizeEvidence(input: {
    evidenceId: string;
    incidentId: string;
    organizationId: string;
    rejectionReason: string | null;
    safe: boolean;
    userId: string;
    version: number;
  }): Promise<MutationResult<IncidentEvidenceValue>>;
  findEvidence(
    organizationId: string,
    userId: string,
    incidentId: string,
    evidenceId: string,
  ): Promise<IncidentEvidenceValue | null>;
  findIncident(
    organizationId: string,
    userId: string,
    incidentId: string,
  ): Promise<
    (IncidentSummary & { lessonsLearned: string | null; rootCause: string | null }) | null
  >;
  getIncidentDetail(organizationId: string, userId: string, incidentId: string): Promise<unknown>;
  getIncidentGraph(organizationId: string, userId: string, incidentId: string): Promise<unknown>;
  listIncidents(
    organizationId: string,
    userId: string,
    filters: {
      assignedMembershipId?: string;
      cursor?: IncidentCursor;
      limit: number;
      search?: string;
      severity?: EventSeverityValue;
      slaBreached?: boolean;
      status?: IncidentStatusValue;
    },
  ): Promise<IncidentSummary[]>;
  listNotifications(organizationId: string, userId: string, limit: number): Promise<unknown[]>;
  listSlaPolicies(organizationId: string, userId: string): Promise<unknown[]>;
  markNotificationRead(
    organizationId: string,
    userId: string,
    notificationId: string,
  ): Promise<MutationResult<unknown>>;
  transition(input: {
    currentStatus: IncidentStatusValue;
    incidentId: string;
    lessonsLearned?: string;
    organizationId: string;
    reason: string;
    rootCause?: string;
    status: IncidentStatusValue;
    userId: string;
    version: number;
  }): Promise<MutationResult<IncidentSummary>>;
  updateAnalysis(input: {
    incidentId: string;
    lessonsLearned?: string | null;
    organizationId: string;
    rootCause?: string | null;
    userId: string;
    version: number;
  }): Promise<MutationResult<IncidentSummary>>;
  updateSlaPolicy(input: {
    enabled: boolean;
    escalationMinutes: number;
    name: string;
    organizationId: string;
    policyId: string;
    resolutionMinutes: number;
    responseMinutes: number;
    userId: string;
    version: number;
  }): Promise<MutationResult<unknown>>;
}
