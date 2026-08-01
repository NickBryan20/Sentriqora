import type { EventSeverityValue, RawEventStatusValue } from '@aegisflow/contracts';

export const EVENT_REPOSITORY_PORT = Symbol('EVENT_REPOSITORY_PORT');

export interface EventCursor {
  id: string;
  occurredAt: Date;
}

export interface EventListFilters {
  assetId?: string;
  connectorId?: string;
  cursor?: EventCursor;
  eventType?: string;
  from?: Date;
  limit: number;
  search?: string;
  severity?: EventSeverityValue;
  to?: Date;
}

export interface NormalizedEventSummary {
  asset: { id: string; key: string; name: string } | null;
  attributes: Record<string, unknown>;
  connector: { id: string; key: string; name: string };
  eventType: string;
  fingerprint: string;
  id: string;
  message: string;
  occurredAt: string;
  receivedAt: string;
  severity: EventSeverityValue;
  sourceEventId: string | null;
}

export interface IngestionReceiptSummary {
  connectorId: string;
  id: string;
  normalizedRecords: number;
  processedAt: string | null;
  receivedAt: string;
  recordCount: number;
  rejectionCode: string | null;
  status: RawEventStatusValue;
}

export interface EventRepositoryPort {
  findReceipt(
    organizationId: string,
    userId: string,
    receiptId: string,
  ): Promise<IngestionReceiptSummary | null>;
  listEvents(
    organizationId: string,
    userId: string,
    filters: EventListFilters,
  ): Promise<NormalizedEventSummary[]>;
}
