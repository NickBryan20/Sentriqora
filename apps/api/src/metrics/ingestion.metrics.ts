import { Counter, Histogram, register } from 'prom-client';

const received =
  (register.getSingleMetric<'authentication' | 'duplicate' | 'format'>(
    'aegisflow_ingestion_received_total',
  ) as Counter<'authentication' | 'duplicate' | 'format'> | undefined) ??
  new Counter({
    help: 'Accepted event-ingestion requests.',
    labelNames: ['authentication', 'duplicate', 'format'] as const,
    name: 'aegisflow_ingestion_received_total',
  });

const rejected =
  (register.getSingleMetric<'reason'>('aegisflow_ingestion_rejected_total') as
    Counter<'reason'> | undefined) ??
  new Counter({
    help: 'Rejected event-ingestion payloads.',
    labelNames: ['reason'] as const,
    name: 'aegisflow_ingestion_rejected_total',
  });

const payloadSize =
  (register.getSingleMetric<'format'>('aegisflow_ingestion_payload_bytes') as
    Histogram<'format'> | undefined) ??
  new Histogram({
    buckets: [256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576],
    help: 'Accepted event-ingestion payload size in bytes.',
    labelNames: ['format'] as const,
    name: 'aegisflow_ingestion_payload_bytes',
  });

export function recordAcceptedIngress(input: {
  authentication: string;
  duplicate: boolean;
  format: string;
  payloadBytes: number;
}): void {
  received.inc({
    authentication: input.authentication,
    duplicate: String(input.duplicate),
    format: input.format,
  });
  payloadSize.observe({ format: input.format }, input.payloadBytes);
}

export function recordRejectedIngress(reason: string): void {
  rejected.inc({ reason });
}
