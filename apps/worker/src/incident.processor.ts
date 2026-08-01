import { IncidentLifecyclePolicy, type IncidentSeverityValue } from '@aegisflow/domain';
import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';

import { withTenantTransaction } from './database';
import { recordIncidentCreated, recordSlaBreach } from './detection.metrics';
import type { IncidentJob } from './outbox-dispatcher';

interface AlertRow {
  asset_id: string | null;
  description: string;
  first_seen_at: Date;
  id: string;
  risk_score: string;
  severity: IncidentSeverityValue;
  title: string;
}

interface IncidentRow {
  assigned_membership_id: string | null;
  first_responded_at: Date | null;
  id: string;
  key: string;
  resolution_breached_at: Date | null;
  resolution_due_at: Date;
  resolved_at: Date | null;
  response_breached_at: Date | null;
  response_due_at: Date;
  status: string;
  title: string;
}

const SLA_DEFAULTS: Readonly<Record<IncidentSeverityValue, readonly [number, number]>> = {
  CRITICAL: [5, 60],
  HIGH: [15, 240],
  INFO: [240, 2_880],
  LOW: [120, 1_440],
  MEDIUM: [30, 720],
};

export class IncidentProcessor {
  private readonly policy = new IncidentLifecyclePolicy();

  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
  ) {}

  process(
    job: IncidentJob,
  ): Promise<{ breached?: boolean; created?: boolean; incidentId?: string }> {
    return 'alertId' in job ? this.fromAlert(job) : this.evaluateSla(job);
  }

  private fromAlert(
    job: Extract<IncidentJob, { alertId: string }>,
  ): Promise<{ created: boolean; incidentId?: string }> {
    return withTenantTransaction(this.pool, job.organizationId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [job.alertId]);
      const linked = await client.query<{ incident_id: string }>(
        `SELECT incident_id FROM incident_alerts
         WHERE organization_id = $1 AND alert_id = $2`,
        [job.organizationId, job.alertId],
      );
      if (linked.rows[0] !== undefined) {
        return { created: false, incidentId: linked.rows[0].incident_id };
      }
      const alertResult = await client.query<AlertRow>(
        `SELECT id, asset_id, title, description, severity, risk_score::text, first_seen_at
         FROM alerts WHERE organization_id = $1 AND id = $2`,
        [job.organizationId, job.alertId],
      );
      const alert = alertResult.rows[0];
      if (alert === undefined) return { created: false };
      const riskScore = Number(alert.risk_score);
      if (!this.policy.shouldCreateAutomatically(alert.severity, riskScore)) {
        return { created: false };
      }
      const policyResult = await client.query<{
        id: string;
        resolution_minutes: number;
        response_minutes: number;
      }>(
        `SELECT id, response_minutes, resolution_minutes FROM sla_policies
         WHERE organization_id = $1 AND severity = $2::event_severity AND enabled
         LIMIT 1`,
        [job.organizationId, alert.severity],
      );
      const slaPolicy = policyResult.rows[0];
      const [responseMinutes, resolutionMinutes] =
        slaPolicy === undefined
          ? SLA_DEFAULTS[alert.severity]
          : [slaPolicy.response_minutes, slaPolicy.resolution_minutes];
      const sla = this.policy.slaTarget(alert.first_seen_at, responseMinutes, resolutionMinutes);
      const incidentId = randomUUID();
      const key = `INC-${incidentId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      await client.query(
        `INSERT INTO incidents (
           id, organization_id, primary_asset_id, sla_policy_id, key, title, description,
           severity, priority, risk_score, first_detected_at, response_due_at,
           resolution_due_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::event_severity,
           $9::incident_priority, $10::numeric, $11, $12, $13, now())`,
        [
          incidentId,
          job.organizationId,
          alert.asset_id,
          slaPolicy?.id ?? null,
          key,
          alert.title,
          alert.description,
          alert.severity,
          this.policy.priorityFor(alert.severity),
          riskScore.toFixed(3),
          alert.first_seen_at,
          sla.responseDueAt,
          sla.resolutionDueAt,
        ],
      );
      await client.query(
        `INSERT INTO incident_alerts (organization_id, incident_id, alert_id)
         VALUES ($1, $2, $3)`,
        [job.organizationId, incidentId, alert.id],
      );
      await client.query(
        `INSERT INTO incident_events (organization_id, incident_id, normalized_event_id)
         SELECT organization_id, $2, normalized_event_id FROM alert_events
         WHERE organization_id = $1 AND alert_id = $3 ON CONFLICT DO NOTHING`,
        [job.organizationId, incidentId, alert.id],
      );
      await client.query(
        `INSERT INTO incident_timeline_entries (
           organization_id, incident_id, type, title, detail
         ) VALUES
           ($1, $2, 'CREATED', 'Incident created automatically', 'High-risk alert policy matched.'),
           ($1, $2, 'ALERT_LINKED', 'Alert linked', left($3, 2000))`,
        [job.organizationId, incidentId, `Alert ${alert.id} linked to the incident.`],
      );
      await client.query(
        `UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_at = COALESCE(acknowledged_at, now()),
           version = version + 1, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status = 'OPEN'`,
        [job.organizationId, alert.id],
      );
      await this.scheduleSla(
        client,
        job.organizationId,
        incidentId,
        sla.responseDueAt,
        sla.resolutionDueAt,
      );
      await this.createNotification(client, {
        body: `${key}: ${alert.title}`,
        channel: 'INTERNAL',
        incidentId,
        organizationId: job.organizationId,
        recipientMembershipId: null,
        title: 'Critical incident created',
        type: 'INCIDENT_CREATED',
      });
      await client.query(
        `INSERT INTO event_records (
           organization_id, action, target_type, target_id, outcome, correlation_id, metadata
         ) VALUES ($1, 'incident.auto_created', 'incident', $2::uuid::text, 'success',
           left($3, 80), jsonb_build_object('alertId', $3::uuid::text, 'severity', $4::text))`,
        [job.organizationId, incidentId, alert.id, alert.severity],
      );
      recordIncidentCreated(alert.severity, true);
      this.logger.info(
        { alertId: alert.id, incidentId, organizationId: hashTenant(job.organizationId) },
        'Incident created automatically',
      );
      return { created: true, incidentId };
    });
  }

  private evaluateSla(
    job: Extract<IncidentJob, { incidentId: string }>,
  ): Promise<{ breached: boolean; incidentId: string }> {
    return withTenantTransaction(this.pool, job.organizationId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${job.incidentId}:${job.kind}`,
      ]);
      const result = await client.query<IncidentRow>(
        `SELECT id, key, title, status, assigned_membership_id, response_due_at,
                resolution_due_at, first_responded_at, resolved_at,
                response_breached_at, resolution_breached_at
         FROM incidents WHERE organization_id = $1 AND id = $2`,
        [job.organizationId, job.incidentId],
      );
      const incident = result.rows[0];
      if (incident === undefined) return { breached: false, incidentId: job.incidentId };
      const now = new Date();
      const responseBreach =
        job.kind === 'RESPONSE' &&
        incident.response_breached_at === null &&
        this.policy.isResponseBreached(now, incident.response_due_at, incident.first_responded_at);
      const resolutionBreach =
        job.kind === 'RESOLUTION' &&
        incident.resolution_breached_at === null &&
        this.policy.isResolutionBreached(now, incident.resolution_due_at, incident.resolved_at);
      if (!responseBreach && !resolutionBreach) {
        return { breached: false, incidentId: job.incidentId };
      }
      const column = responseBreach ? 'response_breached_at' : 'resolution_breached_at';
      const update = await client.query(
        `UPDATE incidents SET ${column} = now(), version = version + 1, updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND ${column} IS NULL`,
        [job.organizationId, job.incidentId],
      );
      if (update.rowCount !== 1) return { breached: false, incidentId: job.incidentId };
      const idempotencyKey = createHash('sha256')
        .update(`sla:${job.incidentId}:${job.kind}`)
        .digest('hex');
      await client.query(
        `INSERT INTO incident_timeline_entries (
           organization_id, incident_id, type, title, detail, idempotency_key
         ) VALUES ($1, $2, 'SLA_BREACHED', $3, $4, $5)
         ON CONFLICT (organization_id, incident_id, idempotency_key) DO NOTHING`,
        [
          job.organizationId,
          job.incidentId,
          `${job.kind} SLA breached`,
          `The ${job.kind.toLowerCase()} target was not completed before its deadline.`,
          idempotencyKey,
        ],
      );
      await this.createNotification(client, {
        body: `${incident.key}: ${job.kind.toLowerCase()} SLA breached.`,
        channel: 'INTERNAL',
        incidentId: incident.id,
        organizationId: job.organizationId,
        recipientMembershipId: incident.assigned_membership_id,
        title: `${job.kind} SLA breached`,
        type: 'INCIDENT_SLA_BREACHED',
      });
      await client.query(
        `INSERT INTO event_records (
           organization_id, action, target_type, target_id, outcome, correlation_id, metadata
         ) VALUES ($1, 'incident.sla_breached', 'incident', $2::uuid::text, 'success',
           left($2::uuid::text, 80), jsonb_build_object('kind', $3::text))`,
        [job.organizationId, job.incidentId, job.kind],
      );
      recordSlaBreach(job.kind);
      return { breached: true, incidentId: job.incidentId };
    });
  }

  private async scheduleSla(
    client: PoolClient,
    organizationId: string,
    incidentId: string,
    responseDueAt: Date,
    resolutionDueAt: Date,
  ): Promise<void> {
    for (const [kind, availableAt] of [
      ['RESPONSE', responseDueAt],
      ['RESOLUTION', resolutionDueAt],
    ] as const) {
      await client.query(
        `INSERT INTO outbox_events (
           organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at, available_at
         ) VALUES ($1, 'incident', $2, 'incident.sla_due.v1',
           jsonb_build_object('organizationId', $1::uuid::text, 'incidentId', $2::uuid::text,
                              'kind', $3::text), now(), $4)`,
        [organizationId, incidentId, kind, availableAt],
      );
    }
  }

  private async createNotification(
    client: PoolClient,
    input: {
      body: string;
      channel: 'EMAIL' | 'INTERNAL';
      incidentId: string;
      organizationId: string;
      recipientMembershipId: string | null;
      title: string;
      type: string;
    },
  ): Promise<void> {
    const key = createHash('sha256')
      .update(
        `${input.type}:${input.incidentId}:${input.recipientMembershipId ?? 'broadcast'}:${input.channel}:${input.body}`,
      )
      .digest('hex');
    const result = await client.query<{ id: string }>(
      `INSERT INTO notifications (
         organization_id, incident_id, recipient_membership_id, channel, type, title, body,
         idempotency_key, updated_at
       ) VALUES ($1, $2, $3, $4::notification_channel, $5, $6, $7, $8, now())
       ON CONFLICT (organization_id, idempotency_key)
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING id`,
      [
        input.organizationId,
        input.incidentId,
        input.recipientMembershipId,
        input.channel,
        input.type,
        input.title,
        input.body,
        key,
      ],
    );
    const notificationId = result.rows[0]?.id;
    if (notificationId === undefined) throw new Error('NotificationCreateFailed');
    await client.query(
      `INSERT INTO outbox_events (
         organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
       ) VALUES ($1, 'notification', $2, 'notification.requested.v1',
         jsonb_build_object('organizationId', $1::uuid::text,
                            'notificationId', $2::uuid::text), now())`,
      [input.organizationId, notificationId],
    );
  }
}

function hashTenant(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
