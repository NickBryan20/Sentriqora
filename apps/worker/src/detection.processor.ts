import {
  detectionRuleConditionSchema,
  type CorrelationDimensionValue,
  type EventSeverityValue,
} from '@aegisflow/contracts';
import { AnomalyScoringPolicy, DetectionRuleFactory, type DetectionEvent } from '@aegisflow/domain';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';

import { withTenantTransaction } from './database';
import {
  observeDetectionBatch,
  recordAlertCreated,
  recordRuleExecution,
} from './detection.metrics';
import type { DetectionJob } from './outbox-dispatcher';

interface EventRow {
  actor_user_hash: string | null;
  asset_id: string | null;
  attributes: unknown;
  event_type: string;
  fingerprint: string;
  id: string;
  message: string;
  occurred_at: Date;
  severity: EventSeverityValue;
  source_ip_hash: string | null;
}
interface RuleRow {
  condition: unknown;
  correlation_dimensions: unknown;
  deduplication_window_seconds: number;
  description: string;
  id: string;
  name: string;
  rule_version_id: string;
  severity: EventSeverityValue;
  threshold: number;
  version: number;
  window_seconds: number;
}

export class DetectionProcessor {
  private readonly factory = new DetectionRuleFactory();
  private readonly scoring = new AnomalyScoringPolicy();

  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
  ) {}

  async process(
    job: DetectionJob,
  ): Promise<{ alerts: number; events: number; executions: number }> {
    const startedAt = performance.now();
    const result = await withTenantTransaction(this.pool, job.organizationId, async (client) => {
      const events = await this.findEvents(client, job);
      const rules = await this.findRules(client, job.organizationId);
      let alerts = 0;
      let executions = 0;
      for (const row of events) {
        const event = toEvent(row);
        const anomaly = await this.scoreAnomaly(client, job.organizationId, row);
        for (const definition of rules) {
          const startedAt = performance.now();
          const correlationDimensions = parseCorrelationDimensions(
            definition.correlation_dimensions,
          );
          const rule = this.factory.create({
            condition: detectionRuleConditionSchema.parse(definition.condition),
            correlationDimensions,
            deduplicationWindowSeconds: definition.deduplication_window_seconds,
            id: definition.id,
            severity: definition.severity,
            threshold: definition.threshold,
            version: definition.version,
            windowSeconds: definition.window_seconds,
          });
          const observedCount = rule.matches(event)
            ? await this.countMatches(client, job.organizationId, row, rule)
            : 0;
          const matched = observedCount >= definition.threshold;
          const riskScore = this.scoring.riskScore(
            definition.severity,
            observedCount,
            definition.threshold,
            anomaly.score,
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO rule_executions (
               organization_id, rule_id, rule_version_id, normalized_event_id,
               matched, observed_count, risk_score, duration_ms
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8)
             ON CONFLICT (organization_id, rule_version_id, normalized_event_id) DO NOTHING
             RETURNING id`,
            [
              job.organizationId,
              definition.id,
              definition.rule_version_id,
              row.id,
              matched,
              observedCount,
              riskScore.toFixed(3),
              Math.max(0, Math.round(performance.now() - startedAt)),
            ],
          );
          if (inserted.rowCount !== 1) continue;
          executions += 1;
          recordRuleExecution(matched);
          if (matched) {
            const created = await this.upsertAlert(
              client,
              job.organizationId,
              row,
              definition,
              rule.correlationKey(event),
              rule.deduplicationKey(event),
              riskScore,
              correlationDimensions,
            );
            if (created) {
              alerts += 1;
              recordAlertCreated(definition.severity);
            }
          }
        }
      }
      await client.query(
        `INSERT INTO event_records (organization_id, action, target_type, target_id, outcome, correlation_id, metadata)
         VALUES ($1, 'detection.batch_completed', 'raw_event', $2::uuid::text, 'success', left($2::uuid::text, 80),
           jsonb_build_object('events', $3::integer, 'executions', $4::integer, 'alertsCreated', $5::integer))`,
        [job.organizationId, job.rawEventId, events.length, executions, alerts],
      );
      this.logger.info(
        {
          alertsCreated: alerts,
          events: events.length,
          executions,
          organizationId: hashTenant(job.organizationId),
          rawEventId: job.rawEventId,
        },
        'Detection batch completed',
      );
      return { alerts, events: events.length, executions };
    });
    observeDetectionBatch((performance.now() - startedAt) / 1_000);
    return result;
  }

  private async findEvents(client: PoolClient, job: DetectionJob): Promise<EventRow[]> {
    const result = await client.query<EventRow>(
      `SELECT id, asset_id, actor_user_hash, source_ip_hash, event_type, severity,
              message, attributes, fingerprint, occurred_at
       FROM normalized_events WHERE organization_id = $1 AND raw_event_id = $2
       ORDER BY record_index`,
      [job.organizationId, job.rawEventId],
    );
    return result.rows;
  }

  private async findRules(client: PoolClient, organizationId: string): Promise<RuleRow[]> {
    const result = await client.query<RuleRow>(
      `SELECT rule.id, rule.name, rule.description, rule.severity, rule.threshold,
              rule.window_seconds, rule.deduplication_window_seconds, rule.condition,
              rule.correlation_dimensions, rule.version, version.id AS rule_version_id
       FROM detection_rules AS rule
       JOIN detection_rule_versions AS version
         ON version.rule_id = rule.id AND version.organization_id = rule.organization_id AND version.version = rule.version
       WHERE rule.organization_id = $1 AND rule.enabled`,
      [organizationId],
    );
    return result.rows;
  }

  private async scoreAnomaly(client: PoolClient, organizationId: string, event: EventRow) {
    const history = await client.query<{ value: number }>(
      `SELECT count(candidate.id)::integer AS value
       FROM generate_series(date_trunc('hour', $3::timestamptz) - interval '24 hours',
                            date_trunc('hour', $3::timestamptz) - interval '1 hour', interval '1 hour') AS bucket
       LEFT JOIN normalized_events AS candidate
         ON candidate.organization_id = $1 AND candidate.event_type = $2
        AND candidate.occurred_at >= bucket AND candidate.occurred_at < bucket + interval '1 hour'
       GROUP BY bucket ORDER BY bucket`,
      [organizationId, event.event_type, event.occurred_at],
    );
    const observed = await client.query<{ value: number }>(
      `SELECT count(*)::integer AS value FROM normalized_events
       WHERE organization_id = $1 AND event_type = $2
         AND occurred_at >= date_trunc('hour', $3::timestamptz) AND occurred_at <= $3`,
      [organizationId, event.event_type, event.occurred_at],
    );
    const result = this.scoring.calculate(
      history.rows.map((row) => row.value),
      observed.rows[0]?.value ?? 0,
    );
    await client.query(
      `INSERT INTO anomaly_scores (organization_id, normalized_event_id, baseline_mean,
         baseline_stddev, moving_average, observed_value, score, is_anomalous)
       VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8)
       ON CONFLICT (organization_id, normalized_event_id, algorithm) DO NOTHING`,
      [
        organizationId,
        event.id,
        fixed(result.baselineMean),
        fixed(result.baselineStdDev),
        fixed(result.movingAverage),
        fixed(result.observedValue),
        result.score.toFixed(4),
        result.isAnomalous,
      ],
    );
    return result;
  }

  private async countMatches(
    client: PoolClient,
    organizationId: string,
    event: EventRow,
    rule: ReturnType<DetectionRuleFactory['create']>,
  ): Promise<number> {
    const result = await client.query<EventRow>(
      `WITH boundary AS (
         SELECT occurred_at AS ended_at
         FROM normalized_events
         WHERE organization_id = $1 AND id = $2
       )
       SELECT candidate.id, candidate.asset_id, candidate.actor_user_hash,
              candidate.source_ip_hash, candidate.event_type, candidate.severity,
              candidate.message, candidate.attributes, candidate.fingerprint,
              candidate.occurred_at
       FROM normalized_events AS candidate
       CROSS JOIN boundary
       WHERE candidate.organization_id = $1
         AND candidate.occurred_at BETWEEN boundary.ended_at - make_interval(secs => $3)
                                           AND boundary.ended_at
       ORDER BY occurred_at DESC LIMIT 10001`,
      [organizationId, event.id, rule.definition.windowSeconds],
    );
    const targetKey = rule.correlationKey(toEvent(event));
    return result.rows.reduce((count, candidate) => {
      const value = toEvent(candidate);
      return count + (rule.matches(value) && rule.correlationKey(value) === targetKey ? 1 : 0);
    }, 0);
  }

  private async upsertAlert(
    client: PoolClient,
    organizationId: string,
    event: EventRow,
    rule: RuleRow,
    correlationKey: string,
    deduplicationKey: string,
    riskScore: number,
    correlationDimensions: CorrelationDimensionValue[],
  ): Promise<boolean> {
    const result = await client.query<{ created: boolean; id: string }>(
      `INSERT INTO alerts (organization_id, rule_id, asset_id, deduplication_key,
         correlation_key, title, description, severity, risk_score, first_seen_at, last_seen_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, left($6, 200), left($7, 2000), $8::event_severity,
               $9::numeric, $10, $10, now())
       ON CONFLICT (organization_id, deduplication_key) DO UPDATE
       SET occurrence_count = alerts.occurrence_count + 1,
           last_seen_at = GREATEST(alerts.last_seen_at, EXCLUDED.last_seen_at),
           risk_score = GREATEST(alerts.risk_score, EXCLUDED.risk_score),
           status = CASE WHEN alerts.status = 'SUPPRESSED' AND alerts.suppressed_until <= now() THEN 'OPEN'::alert_status ELSE alerts.status END,
           suppressed_until = CASE WHEN alerts.status = 'SUPPRESSED' AND alerts.suppressed_until <= now() THEN NULL ELSE alerts.suppressed_until END,
           suppression_reason = CASE WHEN alerts.status = 'SUPPRESSED' AND alerts.suppressed_until <= now() THEN NULL ELSE alerts.suppression_reason END,
           version = alerts.version + 1, updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
      [
        organizationId,
        rule.id,
        event.asset_id,
        deduplicationKey,
        correlationKey,
        `${rule.name}: ${event.event_type}`,
        event.message || rule.description,
        rule.severity,
        riskScore.toFixed(3),
        event.occurred_at,
      ],
    );
    const alert = result.rows[0];
    if (alert === undefined) throw new Error('AlertUpsertFailed');
    await client.query(
      `INSERT INTO alert_events (organization_id, alert_id, normalized_event_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [organizationId, alert.id, event.id],
    );
    await this.correlate(client, organizationId, alert.id, event, correlationDimensions);
    if (alert.created) {
      await client.query(
        `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
         VALUES ($1, 'alert', $2, 'alert.created.v1', jsonb_build_object(
           'organizationId', $1::uuid::text, 'alertId', $2::uuid::text, 'severity', $3::text,
           'riskScore', $4::numeric), now())`,
        [organizationId, alert.id, rule.severity, riskScore.toFixed(3)],
      );
    }
    return alert.created;
  }

  private async correlate(
    client: PoolClient,
    organizationId: string,
    alertId: string,
    event: EventRow,
    dimensions: CorrelationDimensionValue[],
  ): Promise<void> {
    for (const dimension of dimensions) {
      const value = dimensionValue(dimension, event);
      if (value === null) continue;
      const column = dimensionColumn(dimension);
      const related = await client.query<{ alert_id: string }>(
        `SELECT DISTINCT link.alert_id
         FROM alert_events AS link
         JOIN normalized_events AS candidate ON candidate.id = link.normalized_event_id AND candidate.organization_id = link.organization_id
         JOIN alerts AS alert ON alert.id = link.alert_id AND alert.organization_id = link.organization_id
         WHERE link.organization_id = $1 AND link.alert_id <> $2 AND candidate.${column} = $3
           AND alert.last_seen_at >= $4::timestamptz - interval '24 hours'
         ORDER BY link.alert_id LIMIT 100`,
        [organizationId, alertId, value, event.occurred_at],
      );
      const valueHash = createHash('sha256').update(`${dimension}:${value}`).digest('hex');
      for (const candidate of related.rows) {
        const [source, target] = [alertId, candidate.alert_id].sort();
        await client.query(
          `INSERT INTO alert_correlation_edges (organization_id, source_alert_id, target_alert_id, dimension, value_hash)
           VALUES ($1, $2, $3, $4::correlation_dimension, $5)
           ON CONFLICT (organization_id, source_alert_id, target_alert_id, dimension, value_hash)
           DO UPDATE SET weight = alert_correlation_edges.weight + 1, last_seen_at = now()`,
          [organizationId, source, target, dimension, valueHash],
        );
      }
    }
  }
}

function toEvent(row: EventRow): DetectionEvent {
  return {
    assetId: row.asset_id,
    actorUserHash: row.actor_user_hash,
    attributes: asObject(row.attributes),
    eventType: row.event_type,
    fingerprint: row.fingerprint,
    message: row.message,
    occurredAt: row.occurred_at,
    severity: row.severity,
    sourceIpHash: row.source_ip_hash,
  };
}
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function fixed(value: number): string {
  return value.toFixed(6);
}
function hashTenant(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
function dimensionValue(dimension: CorrelationDimensionValue, event: EventRow): string | null {
  if (dimension === 'ACTOR_USER') return event.actor_user_hash;
  if (dimension === 'ASSET') return event.asset_id;
  if (dimension === 'EVENT_TYPE') return event.event_type;
  if (dimension === 'FINGERPRINT') return event.fingerprint;
  return event.source_ip_hash;
}
function dimensionColumn(
  dimension: CorrelationDimensionValue,
): 'actor_user_hash' | 'asset_id' | 'event_type' | 'fingerprint' | 'source_ip_hash' {
  if (dimension === 'ACTOR_USER') return 'actor_user_hash';
  if (dimension === 'ASSET') return 'asset_id';
  if (dimension === 'EVENT_TYPE') return 'event_type';
  if (dimension === 'FINGERPRINT') return 'fingerprint';
  return 'source_ip_hash';
}

function parseCorrelationDimensions(value: unknown): CorrelationDimensionValue[] {
  const dimensions = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.startsWith('{') && value.endsWith('}')
      ? value
          .slice(1, -1)
          .split(',')
          .filter((entry) => entry.length > 0)
      : [];
  const allowed = new Set(['ACTOR_USER', 'SOURCE_IP', 'ASSET', 'EVENT_TYPE', 'FINGERPRINT']);
  if (
    dimensions.length < 1 ||
    dimensions.length > 3 ||
    dimensions.some((item) => typeof item !== 'string' || !allowed.has(item))
  ) {
    throw new Error('InvalidCorrelationDimensions');
  }
  return dimensions as CorrelationDimensionValue[];
}
