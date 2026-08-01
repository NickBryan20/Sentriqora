import {
  adaptEventCandidate,
  EventPayloadValidationError,
  parseEventCandidates,
  type EventFormatValue,
} from '@aegisflow/contracts';
import {
  EventNormalizationError,
  EventNormalizationPolicy,
  type NormalizedEventValue,
} from '@aegisflow/domain';
import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';

import { withTenantTransaction } from './database';
import type { IngestionJob } from './outbox-dispatcher';
import type { PayloadCrypto } from './payload-crypto';

interface RawEventRow {
  connector_id: string;
  connector_type: 'CSV_IMPORT' | 'GITHUB' | 'JSON_IMPORT' | 'REST_API' | 'SIMULATOR' | 'WEBHOOK';
  encrypted_payload: string;
  encryption_auth_tag: string;
  encryption_iv: string;
  format: EventFormatValue;
  received_at: Date;
  record_count: number;
  retention_until: Date;
  status: string;
}

export class EventIngestionProcessor {
  private readonly policy = new EventNormalizationPolicy();
  private readonly pepper: Buffer;

  constructor(
    private readonly pool: Pool,
    private readonly crypto: PayloadCrypto,
    pepper: string,
    private readonly logger: Logger,
  ) {
    if (pepper.length < 32)
      throw new Error('AUTH_TOKEN_PEPPER must contain at least 32 characters');
    this.pepper = Buffer.from(pepper, 'utf8');
  }

  async process(job: IngestionJob): Promise<{ normalizedRecords: number; status: string }> {
    try {
      return await withTenantTransaction(this.pool, job.organizationId, async (client) => {
        const rawEvent = await this.findRawEvent(client, job);
        if (rawEvent.status === 'NORMALIZED' || rawEvent.status === 'REJECTED') {
          return {
            normalizedRecords: rawEvent.status === 'NORMALIZED' ? rawEvent.record_count : 0,
            status: rawEvent.status,
          };
        }
        await client.query(
          `UPDATE raw_events
           SET status = 'PROCESSING', retry_count = retry_count + 1, updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [job.rawEventId, job.organizationId],
        );
        const text = this.crypto.decrypt({
          authTag: rawEvent.encryption_auth_tag,
          ciphertext: rawEvent.encrypted_payload,
          iv: rawEvent.encryption_iv,
        });
        const candidates = parseEventCandidates(rawEvent.format, text);
        if (candidates.length !== rawEvent.record_count) {
          throw new EventPayloadValidationError('payload_limits_exceeded');
        }
        const normalized = candidates.map((candidate, index) =>
          this.policy.normalize(
            adaptEventCandidate(rawEvent.connector_type, candidate, rawEvent.received_at),
            index,
            rawEvent.received_at,
            (value) => this.pseudonymize(value),
          ),
        );
        const assets = await this.findAssets(client, job.organizationId, normalized);
        await this.insertNormalizedEvents(client, job, rawEvent, normalized, assets);
        await client.query(
          `UPDATE raw_events
           SET status = 'NORMALIZED', processed_at = now(), rejection_code = NULL, updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [job.rawEventId, job.organizationId],
        );
        await this.recordCompletion(client, job, normalized.length);
        return { normalizedRecords: normalized.length, status: 'NORMALIZED' };
      });
    } catch (error) {
      if (isRejectedEvent(error)) {
        await this.markRejected(job, rejectionCode(error));
        this.logger.warn(
          { rawEventId: job.rawEventId, rejectionCode: rejectionCode(error) },
          'Raw event rejected during normalization',
        );
        return { normalizedRecords: 0, status: 'REJECTED' };
      }
      await this.markFailed(job);
      throw error;
    }
  }

  private async findRawEvent(client: PoolClient, job: IngestionJob): Promise<RawEventRow> {
    const result = await client.query<RawEventRow>(
      `SELECT raw.connector_id, connector.type AS connector_type,
              raw.encrypted_payload, raw.encryption_auth_tag, raw.encryption_iv,
              raw.format, raw.received_at, raw.record_count, raw.retention_until, raw.status
       FROM raw_events AS raw
       JOIN connectors AS connector
         ON connector.id = raw.connector_id AND connector.organization_id = raw.organization_id
       WHERE raw.id = $1 AND raw.organization_id = $2
       FOR UPDATE OF raw`,
      [job.rawEventId, job.organizationId],
    );
    const rawEvent = result.rows[0];
    if (rawEvent === undefined || rawEvent.connector_id !== job.connectorId) {
      throw new Error('RawEventNotFound');
    }
    return rawEvent;
  }

  private async findAssets(
    client: PoolClient,
    organizationId: string,
    events: NormalizedEventValue[],
  ): Promise<Map<string, string>> {
    const keys = [
      ...new Set(events.flatMap((event) => (event.assetKey === null ? [] : [event.assetKey]))),
    ];
    if (keys.length === 0) return new Map();
    const result = await client.query<{ id: string; key: string }>(
      `SELECT id, key FROM assets
       WHERE organization_id = $1 AND key = ANY($2::text[]) AND status = 'ACTIVE'`,
      [organizationId, keys],
    );
    return new Map(result.rows.map((asset) => [asset.key, asset.id]));
  }

  private async insertNormalizedEvents(
    client: PoolClient,
    job: IngestionJob,
    raw: RawEventRow,
    events: NormalizedEventValue[],
    assets: Map<string, string>,
  ): Promise<void> {
    const parameters: unknown[] = [];
    const values = events.map((event) => {
      const start = parameters.length;
      parameters.push(
        job.organizationId,
        job.rawEventId,
        job.connectorId,
        event.assetKey === null ? null : (assets.get(event.assetKey) ?? null),
        event.recordIndex,
        event.sourceEventId,
        event.eventType,
        event.severity,
        event.message,
        event.actorUserHash,
        event.sourceIpHash,
        JSON.stringify(event.attributes),
        event.fingerprint,
        event.occurredAt,
        raw.received_at,
        raw.retention_until,
      );
      const at = (offset: number) => `$${start + offset}`;
      return `(${at(1)}::uuid, ${at(2)}::uuid, ${at(3)}::uuid, ${at(4)}::uuid,
        ${at(5)}, ${at(6)}, ${at(7)}, ${at(8)}::event_severity, ${at(9)}, ${at(10)},
        ${at(11)}, ${at(12)}::jsonb, ${at(13)}, ${at(14)}, ${at(15)}, ${at(16)})`;
    });
    await client.query(
      `INSERT INTO normalized_events (
         organization_id, raw_event_id, connector_id, asset_id, record_index,
         source_event_id, event_type, severity, message, actor_user_hash, source_ip_hash,
         attributes, fingerprint, occurred_at, received_at, retention_until
       ) VALUES ${values.join(',')}
       ON CONFLICT (raw_event_id, record_index) DO NOTHING`,
      parameters,
    );
  }

  private async recordCompletion(
    client: PoolClient,
    job: IngestionJob,
    count: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO event_records (
         organization_id, action, target_type, target_id,
         outcome, correlation_id, metadata
       ) VALUES ($1, 'raw_event.normalized', 'raw_event', $2,
                 'success', left($3, 80), jsonb_build_object('normalizedRecords', $4::integer))`,
      [job.organizationId, job.rawEventId, job.correlationId, count],
    );
    await client.query(
      `INSERT INTO outbox_events (
         organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
       ) VALUES ($1, 'raw_event', $2, 'normalized_event.batch_created.v1',
         jsonb_build_object('organizationId', $1::uuid::text, 'rawEventId', $2::uuid::text,
                            'normalizedRecords', $3::integer), now())`,
      [job.organizationId, job.rawEventId, count],
    );
  }

  private async markRejected(job: IngestionJob, code: string): Promise<void> {
    await withTenantTransaction(this.pool, job.organizationId, async (client) => {
      await client.query(
        `UPDATE raw_events
         SET status = 'REJECTED', processed_at = now(), rejection_code = $3, updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND status <> 'NORMALIZED'`,
        [job.rawEventId, job.organizationId, code],
      );
    });
  }

  private async markFailed(job: IngestionJob): Promise<void> {
    try {
      await withTenantTransaction(this.pool, job.organizationId, async (client) => {
        await client.query(
          `UPDATE raw_events
           SET status = 'FAILED', updated_at = now()
           WHERE id = $1 AND organization_id = $2 AND status NOT IN ('NORMALIZED', 'REJECTED')`,
          [job.rawEventId, job.organizationId],
        );
      });
    } catch {
      this.logger.error({ rawEventId: job.rawEventId }, 'Could not mark raw event as failed');
    }
  }

  private pseudonymize(value: string): string {
    return createHmac('sha256', this.pepper).update(value).digest('hex');
  }
}

function isRejectedEvent(error: unknown): boolean {
  return (
    error instanceof EventPayloadValidationError ||
    error instanceof EventNormalizationError ||
    error instanceof ZodError
  );
}

function rejectionCode(error: unknown): string {
  if (error instanceof EventPayloadValidationError || error instanceof EventNormalizationError) {
    return error.code;
  }
  return 'invalid_event_schema';
}
