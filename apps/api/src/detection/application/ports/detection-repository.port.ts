import type {
  AlertStatusValue,
  CorrelationDimensionValue,
  DetectionRuleCondition,
  EventSeverityValue,
} from '@aegisflow/contracts';

export const DETECTION_REPOSITORY_PORT = Symbol('DETECTION_REPOSITORY_PORT');

export interface DetectionRuleSummary {
  condition: DetectionRuleCondition;
  correlationDimensions: CorrelationDimensionValue[];
  createdAt: string;
  deduplicationWindowSeconds: number;
  description: string;
  enabled: boolean;
  id: string;
  key: string;
  name: string;
  severity: EventSeverityValue;
  threshold: number;
  updatedAt: string;
  version: number;
  windowSeconds: number;
}

export interface AlertSummary {
  asset: { id: string; key: string; name: string } | null;
  assignedMembershipId: string | null;
  correlationKey: string;
  createdAt: string;
  id: string;
  lastSeenAt: string;
  occurrenceCount: number;
  riskScore: number;
  rule: { id: string; key: string; name: string };
  severity: EventSeverityValue;
  status: AlertStatusValue;
  suppressedUntil: string | null;
  title: string;
  version: number;
}

export interface AlertCursor {
  id: string;
  lastSeenAt: Date;
}

export interface AlertListFilters {
  assignedMembershipId?: string;
  cursor?: AlertCursor;
  limit: number;
  search?: string;
  severity?: EventSeverityValue;
  status?: AlertStatusValue;
}

export type MutationResult<T> =
  { kind: 'conflict' } | { kind: 'not_found' } | { kind: 'success'; value: T };

export interface DetectionRepositoryPort {
  createRule(input: {
    idempotency: { actorUserId: string; keyHash: string; requestHash: string; scope: string };
    organizationId: string;
    rule: Omit<DetectionRuleSummary, 'createdAt' | 'id' | 'updatedAt' | 'version'>;
    userId: string;
    audit: { correlationId: string; ipHash: string };
  }): Promise<{ replayed: boolean; value: DetectionRuleSummary }>;
  findAlert(
    organizationId: string,
    userId: string,
    alertId: string,
  ): Promise<
    | (AlertSummary & {
        description: string;
        events: {
          eventType: string;
          id: string;
          message: string;
          occurredAt: string;
          severity: EventSeverityValue;
        }[];
        firstSeenAt: string;
        suppressionReason: string | null;
      })
    | null
  >;
  getAlertGraph(
    organizationId: string,
    userId: string,
    alertId: string,
  ): Promise<{
    edges: {
      dimension: CorrelationDimensionValue;
      id: string;
      source: string;
      target: string;
      weight: number;
    }[];
    nodes: AlertSummary[];
  } | null>;
  listAlerts(
    organizationId: string,
    userId: string,
    filters: AlertListFilters,
  ): Promise<AlertSummary[]>;
  listRules(organizationId: string, userId: string): Promise<DetectionRuleSummary[]>;
  setRuleEnabled(input: {
    enabled: boolean;
    organizationId: string;
    ruleId: string;
    userId: string;
    version: number;
  }): Promise<MutationResult<DetectionRuleSummary>>;
  suppressAlert(input: {
    alertId: string;
    organizationId: string;
    reason: string;
    suppressedUntil: Date;
    userId: string;
    version: number;
  }): Promise<MutationResult<AlertSummary>>;
  triageAlert(input: {
    alertId: string;
    assignedMembershipId?: string | null;
    organizationId: string;
    status: 'ACKNOWLEDGED' | 'CLOSED';
    userId: string;
    version: number;
  }): Promise<MutationResult<AlertSummary>>;
  updateRule(input: {
    changes: Partial<
      Omit<DetectionRuleSummary, 'createdAt' | 'enabled' | 'id' | 'key' | 'updatedAt' | 'version'>
    >;
    organizationId: string;
    ruleId: string;
    userId: string;
    version: number;
  }): Promise<MutationResult<DetectionRuleSummary>>;
}
