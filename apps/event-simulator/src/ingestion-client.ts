import {
  ingressReceiptSchema,
  type CanonicalEvent,
  type IngressReceipt,
} from '@aegisflow/contracts';

export interface IngestionTarget {
  apiKey: string;
  baseUrl: string;
  connectorId: string;
  organizationId: string;
}

export async function sendEvent(
  target: IngestionTarget,
  event: CanonicalEvent,
  timeoutMs = 5_000,
): Promise<IngressReceipt> {
  const baseUrl = target.baseUrl.endsWith('/') ? target.baseUrl.slice(0, -1) : target.baseUrl;
  const response = await fetch(
    `${baseUrl}/ingress/organizations/${encodeURIComponent(target.organizationId)}/connectors/${encodeURIComponent(target.connectorId)}`,
    {
      body: JSON.stringify(event),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `simulator-${event.sourceEventId ?? crypto.randomUUID()}`,
        'x-api-key': target.apiKey,
        'x-correlation-id': `simulator-${crypto.randomUUID()}`,
      },
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) {
    throw new Error(`AegisFlow ingestion failed with HTTP ${response.status}`);
  }
  return ingressReceiptSchema.parse(await response.json());
}
