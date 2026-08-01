import type {
  EventSeverityValue,
  IncidentPriorityValue,
  IncidentStatusValue,
} from '@aegisflow/contracts';
import { IncidentLifecyclePolicy } from '@aegisflow/domain';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { ApplicationError } from '../../identity/application/application-error';
import type { Prisma } from '../../generated/prisma/client';
import { IdempotencyStatus } from '../../generated/prisma/enums';
import { TenantPrismaExecutor } from '../../identity/infrastructure/prisma/tenant-prisma.executor';
import type {
  IdempotencyContext,
  IncidentEvidenceValue,
  IncidentRepositoryPort,
  IncidentSummary,
  MutationResult,
} from '../application/ports/incident-repository.port';

type Transaction = Prisma.TransactionClient;

const SLA_DEFAULTS: Readonly<Record<EventSeverityValue, readonly [number, number]>> = {
  CRITICAL: [5, 60],
  HIGH: [15, 240],
  INFO: [240, 2_880],
  LOW: [120, 1_440],
  MEDIUM: [30, 720],
};
const SEVERITY_RANK: Readonly<Record<EventSeverityValue, number>> = {
  CRITICAL: 5,
  HIGH: 4,
  INFO: 1,
  LOW: 2,
  MEDIUM: 3,
};

@Injectable()
export class PrismaIncidentRepository implements IncidentRepositoryPort {
  private readonly lifecycle = new IncidentLifecyclePolicy();

  constructor(@Inject(TenantPrismaExecutor) private readonly executor: TenantPrismaExecutor) {}

  listIncidents(
    organizationId: string,
    userId: string,
    filters: Parameters<IncidentRepositoryPort['listIncidents']>[2],
  ): Promise<IncidentSummary[]> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const cursorFilter =
        filters.cursor === undefined
          ? undefined
          : {
              OR: [
                { updatedAt: { lt: filters.cursor.updatedAt } },
                { id: { lt: filters.cursor.id }, updatedAt: filters.cursor.updatedAt },
              ],
            };
      const now = new Date();
      const rows = await tx.incident.findMany({
        include: summaryInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: filters.limit,
        where: {
          organizationId,
          ...(cursorFilter === undefined ? {} : { AND: [cursorFilter] }),
          ...(filters.assignedMembershipId === undefined
            ? {}
            : { assignedMembershipId: filters.assignedMembershipId }),
          ...(filters.search === undefined
            ? {}
            : {
                OR: [
                  { key: { contains: filters.search, mode: 'insensitive' } },
                  { title: { contains: filters.search, mode: 'insensitive' } },
                  { description: { contains: filters.search, mode: 'insensitive' } },
                ],
              }),
          ...(filters.severity === undefined ? {} : { severity: filters.severity }),
          ...(filters.status === undefined ? {} : { status: filters.status }),
          ...(filters.slaBreached === undefined
            ? {}
            : filters.slaBreached
              ? {
                  OR: [
                    { firstRespondedAt: null, responseDueAt: { lte: now } },
                    { resolvedAt: null, resolutionDueAt: { lte: now } },
                    { responseBreachedAt: { not: null } },
                    { resolutionBreachedAt: { not: null } },
                  ],
                }
              : {
                  AND: [
                    { OR: [{ firstRespondedAt: { not: null } }, { responseDueAt: { gt: now } }] },
                    { OR: [{ resolvedAt: { not: null } }, { resolutionDueAt: { gt: now } }] },
                    { responseBreachedAt: null },
                    { resolutionBreachedAt: null },
                  ],
                }),
        },
      });
      return rows.map(incidentSummary);
    });
  }

  findIncident(
    organizationId: string,
    userId: string,
    incidentId: string,
  ): ReturnType<IncidentRepositoryPort['findIncident']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const row = await tx.incident.findFirst({
        include: summaryInclude,
        where: { id: incidentId, organizationId },
      });
      return row === null
        ? null
        : {
            ...incidentSummary(row),
            lessonsLearned: row.lessonsLearned,
            rootCause: row.rootCause,
          };
    });
  }

  getIncidentDetail(
    organizationId: string,
    userId: string,
    incidentId: string,
  ): ReturnType<IncidentRepositoryPort['getIncidentDetail']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const row = await tx.incident.findFirst({
        include: {
          ...summaryInclude,
          alerts: {
            include: {
              alert: {
                select: {
                  id: true,
                  riskScore: true,
                  severity: true,
                  status: true,
                  title: true,
                },
              },
            },
            orderBy: { linkedAt: 'desc' },
            take: 100,
          },
          comments: {
            include: { author: { select: { displayName: true, id: true } } },
            orderBy: { createdAt: 'asc' },
            take: 200,
          },
          events: {
            include: {
              normalizedEvent: {
                select: {
                  eventType: true,
                  id: true,
                  message: true,
                  occurredAt: true,
                  severity: true,
                },
              },
            },
            orderBy: { linkedAt: 'desc' },
            take: 200,
          },
          evidence: { orderBy: { createdAt: 'desc' }, take: 100 },
          timeline: {
            include: { actor: { select: { displayName: true, id: true } } },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            take: 500,
          },
        },
        where: { id: incidentId, organizationId },
      });
      if (row === null) return null;
      return {
        ...incidentSummary(row),
        alerts: row.alerts.map((link) => ({
          ...link.alert,
          riskScore: Number(link.alert.riskScore),
        })),
        comments: row.comments.map((comment) => ({
          author: comment.author,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          id: comment.id,
          version: comment.version,
        })),
        description: row.description,
        events: row.events.map(({ normalizedEvent }) => ({
          ...normalizedEvent,
          occurredAt: normalizedEvent.occurredAt.toISOString(),
        })),
        evidence: row.evidence.map((evidence) => publicEvidence(evidence)),
        lessonsLearned: row.lessonsLearned,
        rootCause: row.rootCause,
        timeline: row.timeline.map((entry) => ({
          actor: entry.actor,
          detail: entry.detail,
          fromStatus: entry.fromStatus,
          id: entry.id,
          occurredAt: entry.occurredAt.toISOString(),
          title: entry.title,
          toStatus: entry.toStatus,
          type: entry.type,
        })),
      };
    });
  }

  getIncidentGraph(
    organizationId: string,
    userId: string,
    incidentId: string,
  ): ReturnType<IncidentRepositoryPort['getIncidentGraph']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const incident = await tx.incident.findFirst({
        include: {
          alerts: {
            include: {
              alert: {
                include: {
                  asset: { select: { id: true, name: true } },
                  incomingCorrelations: { take: 50 },
                  outgoingCorrelations: { take: 50 },
                },
              },
            },
            take: 100,
          },
          primaryAsset: { select: { id: true, name: true } },
        },
        where: { id: incidentId, organizationId },
      });
      if (incident === null) return null;
      const nodes = new Map<string, { id: string; kind: string; label: string }>();
      const edges = new Map<
        string,
        { id: string; kind: string; source: string; target: string; weight: number }
      >();
      nodes.set(incident.id, { id: incident.id, kind: 'INCIDENT', label: incident.key });
      if (incident.primaryAsset !== null) {
        nodes.set(incident.primaryAsset.id, {
          id: incident.primaryAsset.id,
          kind: 'ASSET',
          label: incident.primaryAsset.name,
        });
        edges.set(`asset:${incident.primaryAsset.id}`, {
          id: `asset:${incident.primaryAsset.id}`,
          kind: 'AFFECTS',
          source: incident.id,
          target: incident.primaryAsset.id,
          weight: 1,
        });
      }
      for (const link of incident.alerts) {
        const alert = link.alert;
        nodes.set(alert.id, { id: alert.id, kind: 'ALERT', label: alert.title });
        edges.set(`contains:${alert.id}`, {
          id: `contains:${alert.id}`,
          kind: 'CONTAINS',
          source: incident.id,
          target: alert.id,
          weight: 1,
        });
        if (alert.asset !== null) {
          nodes.set(alert.asset.id, {
            id: alert.asset.id,
            kind: 'ASSET',
            label: alert.asset.name,
          });
          edges.set(`alert-asset:${alert.id}:${alert.asset.id}`, {
            id: `alert-asset:${alert.id}:${alert.asset.id}`,
            kind: 'AFFECTS',
            source: alert.id,
            target: alert.asset.id,
            weight: 1,
          });
        }
        for (const correlation of [...alert.incomingCorrelations, ...alert.outgoingCorrelations]) {
          const relatedId =
            correlation.sourceAlertId === alert.id
              ? correlation.targetAlertId
              : correlation.sourceAlertId;
          if (incident.alerts.some((candidate) => candidate.alert.id === relatedId)) {
            edges.set(correlation.id, {
              id: correlation.id,
              kind: correlation.dimension,
              source: correlation.sourceAlertId,
              target: correlation.targetAlertId,
              weight: correlation.weight,
            });
          }
        }
      }
      return { edges: [...edges.values()], nodes: [...nodes.values()] };
    });
  }

  createIncident(
    input: Parameters<IncidentRepositoryPort['createIncident']>[0],
  ): ReturnType<IncidentRepositoryPort['createIncident']> {
    return this.executor.run({ organizationId: input.organizationId, userId: input.userId }, (tx) =>
      this.idempotent(tx, input.organizationId, input.idempotency, 'incident', async () => {
        const alerts = await tx.alert.findMany({
          include: { events: { select: { normalizedEventId: true } } },
          where: { id: { in: input.alertIds }, organizationId: input.organizationId },
        });
        if (alerts.length !== new Set(input.alertIds).size) throw notFoundError('alert');
        const linked = await tx.incidentAlert.findFirst({
          where: { alertId: { in: input.alertIds }, organizationId: input.organizationId },
        });
        if (linked !== null) {
          throw new ApplicationError(
            'conflict',
            'One of the alerts already belongs to an incident.',
            409,
          );
        }
        const severity = highestSeverity([
          ...alerts.map((alert) => alert.severity),
          ...(input.severity === undefined ? [] : [input.severity]),
        ]);
        const policy = await tx.slaPolicy.findFirst({
          where: { enabled: true, organizationId: input.organizationId, severity },
        });
        const [responseMinutes, resolutionMinutes] =
          policy === null
            ? SLA_DEFAULTS[severity]
            : [policy.responseMinutes, policy.resolutionMinutes];
        const detectedAt = new Date(
          Math.min(...alerts.map((alert) => alert.firstSeenAt.getTime())),
        );
        const sla = this.lifecycle.slaTarget(detectedAt, responseMinutes, resolutionMinutes);
        const id = randomUUID();
        const created = await tx.incident.create({
          data: {
            ...sla,
            description: input.description,
            firstDetectedAt: detectedAt,
            id,
            key: incidentKey(id),
            organizationId: input.organizationId,
            primaryAssetId: alerts.find((alert) => alert.assetId !== null)?.assetId ?? null,
            priority: this.lifecycle.priorityFor(severity),
            resolutionDueAt: sla.resolutionDueAt,
            responseDueAt: sla.responseDueAt,
            riskScore: Math.max(...alerts.map((alert) => Number(alert.riskScore))),
            severity,
            slaPolicyId: policy?.id ?? null,
            title: input.title,
          },
        });
        await this.linkAlertsAndEvents(tx, input.organizationId, created.id, alerts);
        await tx.alert.updateMany({
          data: { acknowledgedAt: new Date(), status: 'ACKNOWLEDGED', version: { increment: 1 } },
          where: {
            id: { in: input.alertIds },
            organizationId: input.organizationId,
            status: 'OPEN',
          },
        });
        await this.timeline(tx, {
          actorUserId: input.userId,
          detail: input.description,
          incidentId: created.id,
          organizationId: input.organizationId,
          title: 'Incident created manually',
          type: 'CREATED',
        });
        await this.scheduleSla(tx, created);
        await this.createNotification(tx, {
          body: `${created.key}: ${created.title}`,
          channel: 'INTERNAL',
          incidentId: created.id,
          organizationId: input.organizationId,
          recipientMembershipId: null,
          title: 'New security incident',
          type: 'INCIDENT_CREATED',
        });
        await this.audit(tx, input.organizationId, input.userId, 'incident.created', created.id, {
          alertCount: alerts.length,
          severity,
        });
        const value = await this.findSummaryOrThrow(tx, input.organizationId, created.id);
        return { resourceId: created.id, value };
      }),
    );
  }

  assign(
    input: Parameters<IncidentRepositoryPort['assign']>[0],
  ): Promise<MutationResult<IncidentSummary>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        if (input.assignedMembershipId !== null) {
          const membership = await tx.membership.findFirst({
            where: {
              id: input.assignedMembershipId,
              organizationId: input.organizationId,
              status: 'ACTIVE',
            },
          });
          if (membership === null) return { kind: 'not_found' };
        }
        const existing = await tx.incident.findFirst({
          where: { id: input.incidentId, organizationId: input.organizationId },
        });
        if (existing === null) return { kind: 'not_found' };
        if (existing.version !== input.version) return { kind: 'conflict' };
        const mutation = await tx.incident.updateMany({
          data: {
            assignedMembershipId: input.assignedMembershipId,
            version: { increment: 1 },
          },
          where: {
            id: input.incidentId,
            organizationId: input.organizationId,
            version: input.version,
          },
        });
        if (mutation.count !== 1) return { kind: 'conflict' };
        await this.timeline(tx, {
          actorUserId: input.userId,
          detail:
            input.assignedMembershipId === null
              ? 'Incident assignment removed.'
              : 'Incident assigned to an active responder.',
          incidentId: input.incidentId,
          organizationId: input.organizationId,
          title: 'Assignment changed',
          type: 'ASSIGNED',
        });
        if (input.assignedMembershipId !== null) {
          const summary = await this.findSummaryOrThrow(tx, input.organizationId, input.incidentId);
          for (const channel of ['INTERNAL', 'EMAIL'] as const) {
            await this.createNotification(tx, {
              body: `${summary.key}: ${summary.title}`,
              channel,
              incidentId: input.incidentId,
              organizationId: input.organizationId,
              recipientMembershipId: input.assignedMembershipId,
              title: 'Incident assigned to you',
              type: 'INCIDENT_ASSIGNED',
            });
          }
        }
        await this.audit(
          tx,
          input.organizationId,
          input.userId,
          'incident.assigned',
          input.incidentId,
          { assignedMembershipId: input.assignedMembershipId },
        );
        return {
          kind: 'success',
          value: await this.findSummaryOrThrow(tx, input.organizationId, input.incidentId),
        };
      },
    );
  }

  transition(
    input: Parameters<IncidentRepositoryPort['transition']>[0],
  ): Promise<MutationResult<IncidentSummary>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        const existing = await tx.incident.findFirst({
          where: { id: input.incidentId, organizationId: input.organizationId },
        });
        if (existing === null) return { kind: 'not_found' };
        if (existing.version !== input.version || existing.status !== input.currentStatus) {
          return { kind: 'conflict' };
        }
        const now = new Date();
        const mutation = await tx.incident.updateMany({
          data: {
            status: input.status,
            version: { increment: 1 },
            ...(input.lessonsLearned === undefined ? {} : { lessonsLearned: input.lessonsLearned }),
            ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
            ...(existing.firstRespondedAt === null && input.status !== 'OPEN'
              ? { firstRespondedAt: now }
              : {}),
            ...(input.status === 'CONTAINED' ? { containedAt: now } : {}),
            ...(input.status === 'RESOLVED' ? { resolvedAt: now } : {}),
            ...(input.status === 'CLOSED'
              ? { closedAt: now, resolvedAt: existing.resolvedAt ?? now }
              : {}),
            ...(input.status === 'INVESTIGATING' &&
            (input.currentStatus === 'RESOLVED' || input.currentStatus === 'CLOSED')
              ? { closedAt: null, resolvedAt: null }
              : {}),
          },
          where: {
            id: input.incidentId,
            organizationId: input.organizationId,
            status: input.currentStatus,
            version: input.version,
          },
        });
        if (mutation.count !== 1) return { kind: 'conflict' };
        await this.timeline(tx, {
          actorUserId: input.userId,
          detail: input.reason,
          fromStatus: input.currentStatus,
          incidentId: input.incidentId,
          organizationId: input.organizationId,
          title: `Status changed to ${input.status}`,
          toStatus: input.status,
          type: 'STATUS_CHANGED',
        });
        const summary = await this.findSummaryOrThrow(tx, input.organizationId, input.incidentId);
        await this.createNotification(tx, {
          body: `${summary.key} changed from ${input.currentStatus} to ${input.status}.`,
          channel: 'INTERNAL',
          incidentId: input.incidentId,
          organizationId: input.organizationId,
          recipientMembershipId: existing.assignedMembershipId,
          title: 'Incident status changed',
          type: 'INCIDENT_STATUS_CHANGED',
        });
        await this.audit(
          tx,
          input.organizationId,
          input.userId,
          'incident.transitioned',
          input.incidentId,
          { from: input.currentStatus, to: input.status },
        );
        return { kind: 'success', value: summary };
      },
    );
  }

  updateAnalysis(
    input: Parameters<IncidentRepositoryPort['updateAnalysis']>[0],
  ): Promise<MutationResult<IncidentSummary>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        const existing = await tx.incident.findFirst({
          where: { id: input.incidentId, organizationId: input.organizationId },
        });
        if (existing === null) return { kind: 'not_found' };
        if (existing.version !== input.version) return { kind: 'conflict' };
        if (
          (existing.status === 'RESOLVED' || existing.status === 'CLOSED') &&
          input.rootCause === null
        ) {
          return { kind: 'conflict' };
        }
        if (existing.status === 'CLOSED' && input.lessonsLearned === null) {
          return { kind: 'conflict' };
        }
        const mutation = await tx.incident.updateMany({
          data: {
            version: { increment: 1 },
            ...(input.lessonsLearned === undefined ? {} : { lessonsLearned: input.lessonsLearned }),
            ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
          },
          where: {
            id: input.incidentId,
            organizationId: input.organizationId,
            version: input.version,
          },
        });
        if (mutation.count !== 1) return { kind: 'conflict' };
        await this.timeline(tx, {
          actorUserId: input.userId,
          detail: 'Root cause or lessons learned were updated.',
          incidentId: input.incidentId,
          organizationId: input.organizationId,
          title: 'Incident analysis updated',
          type: 'ANALYSIS_UPDATED',
        });
        await this.audit(
          tx,
          input.organizationId,
          input.userId,
          'incident.analysis_updated',
          input.incidentId,
          {},
        );
        return {
          kind: 'success',
          value: await this.findSummaryOrThrow(tx, input.organizationId, input.incidentId),
        };
      },
    );
  }

  addComment(
    input: Parameters<IncidentRepositoryPort['addComment']>[0],
  ): ReturnType<IncidentRepositoryPort['addComment']> {
    return this.executor.run({ organizationId: input.organizationId, userId: input.userId }, (tx) =>
      this.idempotent(tx, input.organizationId, input.idempotency, 'incident_comment', async () => {
        const incident = await tx.incident.findFirst({
          select: { id: true },
          where: { id: input.incidentId, organizationId: input.organizationId },
        });
        if (incident === null) throw notFoundError('incident');
        const comment = await tx.incidentComment.create({
          data: {
            authorUserId: input.userId,
            body: input.body,
            incidentId: input.incidentId,
            organizationId: input.organizationId,
          },
          include: { author: { select: { displayName: true, id: true } } },
        });
        await this.timeline(tx, {
          actorUserId: input.userId,
          detail: 'A responder added a comment.',
          incidentId: input.incidentId,
          organizationId: input.organizationId,
          title: 'Comment added',
          type: 'COMMENT_ADDED',
        });
        const value = {
          author: comment.author,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          id: comment.id,
          version: comment.version,
        };
        await this.audit(
          tx,
          input.organizationId,
          input.userId,
          'incident.comment_added',
          input.incidentId,
          { commentId: comment.id },
        );
        return { resourceId: comment.id, value };
      }),
    );
  }

  createEvidence(
    input: Parameters<IncidentRepositoryPort['createEvidence']>[0],
  ): ReturnType<IncidentRepositoryPort['createEvidence']> {
    return this.executor.run({ organizationId: input.organizationId, userId: input.userId }, (tx) =>
      this.idempotent(
        tx,
        input.organizationId,
        input.idempotency,
        'incident_evidence',
        async () => {
          const incident = await tx.incident.findFirst({
            select: { id: true },
            where: { id: input.incidentId, organizationId: input.organizationId },
          });
          if (incident === null) throw notFoundError('incident');
          let evidence;
          try {
            evidence = await tx.incidentEvidence.create({
              data: {
                contentType: input.contentType,
                fileName: input.fileName,
                id: input.evidenceId,
                incidentId: input.incidentId,
                objectKey: input.objectKey,
                organizationId: input.organizationId,
                sha256: input.sha256,
                sizeBytes: input.sizeBytes,
                uploadedByUserId: input.userId,
              },
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ApplicationError(
                'conflict',
                'The same evidence is already attached to this incident.',
                409,
              );
            }
            throw error;
          }
          const value = evidenceValue(evidence);
          await this.audit(
            tx,
            input.organizationId,
            input.userId,
            'incident.evidence_upload_requested',
            input.incidentId,
            { contentType: input.contentType, evidenceId: evidence.id, sizeBytes: input.sizeBytes },
          );
          return { resourceId: evidence.id, value };
        },
      ),
    );
  }

  beginEvidenceInspection(
    input: Parameters<IncidentRepositoryPort['beginEvidenceInspection']>[0],
  ): Promise<MutationResult<IncidentEvidenceValue>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        const evidence = await tx.incidentEvidence.findFirst({
          where: {
            id: input.evidenceId,
            incidentId: input.incidentId,
            organizationId: input.organizationId,
          },
        });
        if (evidence === null) return { kind: 'not_found' };
        if (
          evidence.version !== input.version ||
          !['PENDING_UPLOAD', 'QUARANTINED'].includes(evidence.status)
        ) {
          return { kind: 'conflict' };
        }
        if (evidence.status === 'QUARANTINED') {
          return { kind: 'success', value: evidenceValue(evidence) };
        }
        const mutation = await tx.incidentEvidence.updateMany({
          data: { status: 'QUARANTINED', version: { increment: 1 } },
          where: {
            id: input.evidenceId,
            incidentId: input.incidentId,
            organizationId: input.organizationId,
            status: evidence.status,
            version: input.version,
          },
        });
        if (mutation.count !== 1) return { kind: 'conflict' };
        const updated = await tx.incidentEvidence.findFirst({
          where: { id: input.evidenceId, organizationId: input.organizationId },
        });
        return updated === null
          ? { kind: 'not_found' }
          : { kind: 'success', value: evidenceValue(updated) };
      },
    );
  }

  finalizeEvidence(
    input: Parameters<IncidentRepositoryPort['finalizeEvidence']>[0],
  ): Promise<MutationResult<IncidentEvidenceValue>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        const evidence = await tx.incidentEvidence.findFirst({
          where: {
            id: input.evidenceId,
            incidentId: input.incidentId,
            organizationId: input.organizationId,
          },
        });
        if (evidence === null) return { kind: 'not_found' };
        if (evidence.version !== input.version || evidence.status !== 'QUARANTINED') {
          return { kind: 'conflict' };
        }
        const mutation = await tx.incidentEvidence.updateMany({
          data: {
            rejectionReason: input.rejectionReason,
            scannedAt: new Date(),
            status: input.safe ? 'AVAILABLE' : 'REJECTED',
            version: { increment: 1 },
          },
          where: {
            id: input.evidenceId,
            organizationId: input.organizationId,
            status: 'QUARANTINED',
            version: input.version,
          },
        });
        if (mutation.count !== 1) return { kind: 'conflict' };
        if (input.safe) {
          await this.timeline(tx, {
            actorUserId: input.userId,
            detail: `Verified evidence: ${evidence.fileName}`,
            incidentId: input.incidentId,
            organizationId: input.organizationId,
            title: 'Evidence attached',
            type: 'EVIDENCE_ADDED',
          });
        }
        await this.audit(
          tx,
          input.organizationId,
          input.userId,
          input.safe ? 'incident.evidence_verified' : 'incident.evidence_rejected',
          input.incidentId,
          { evidenceId: input.evidenceId, rejectionReason: input.rejectionReason },
        );
        const updated = await tx.incidentEvidence.findFirst({
          where: { id: input.evidenceId, organizationId: input.organizationId },
        });
        return updated === null
          ? { kind: 'not_found' }
          : { kind: 'success', value: evidenceValue(updated) };
      },
    );
  }

  findEvidence(
    organizationId: string,
    userId: string,
    incidentId: string,
    evidenceId: string,
  ): ReturnType<IncidentRepositoryPort['findEvidence']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const evidence = await tx.incidentEvidence.findFirst({
        where: { id: evidenceId, incidentId, organizationId },
      });
      return evidence === null ? null : evidenceValue(evidence);
    });
  }

  listSlaPolicies(
    organizationId: string,
    userId: string,
  ): ReturnType<IncidentRepositoryPort['listSlaPolicies']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const policies = await tx.slaPolicy.findMany({
        orderBy: { severity: 'asc' },
        where: { organizationId },
      });
      return policies.map((policy) => ({
        ...policy,
        createdAt: policy.createdAt.toISOString(),
        updatedAt: policy.updatedAt.toISOString(),
      }));
    });
  }

  updateSlaPolicy(
    input: Parameters<IncidentRepositoryPort['updateSlaPolicy']>[0],
  ): Promise<MutationResult<unknown>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        const existing = await tx.slaPolicy.findFirst({
          where: { id: input.policyId, organizationId: input.organizationId },
        });
        if (existing === null) return { kind: 'not_found' };
        if (existing.version !== input.version) return { kind: 'conflict' };
        const mutation = await tx.slaPolicy.updateMany({
          data: {
            enabled: input.enabled,
            escalationMinutes: input.escalationMinutes,
            name: input.name,
            resolutionMinutes: input.resolutionMinutes,
            responseMinutes: input.responseMinutes,
            version: { increment: 1 },
          },
          where: {
            id: input.policyId,
            organizationId: input.organizationId,
            version: input.version,
          },
        });
        if (mutation.count !== 1) return { kind: 'conflict' };
        await this.audit(
          tx,
          input.organizationId,
          input.userId,
          'sla_policy.updated',
          input.policyId,
          { severity: existing.severity },
        );
        const updated = await tx.slaPolicy.findFirst({
          where: { id: input.policyId, organizationId: input.organizationId },
        });
        return updated === null
          ? { kind: 'not_found' }
          : {
              kind: 'success',
              value: {
                ...updated,
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
              },
            };
      },
    );
  }

  listNotifications(
    organizationId: string,
    userId: string,
    limit: number,
  ): ReturnType<IncidentRepositoryPort['listNotifications']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const membership = await tx.membership.findFirst({
        select: { id: true },
        where: { organizationId, status: 'ACTIVE', userId },
      });
      const rows = await tx.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        where: {
          channel: 'INTERNAL',
          organizationId,
          OR: [
            { recipientMembershipId: null },
            ...(membership === null ? [] : [{ recipientMembershipId: membership.id }]),
          ],
        },
      });
      return rows.map((row) => ({
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        incidentId: row.incidentId,
        readAt: row.readAt?.toISOString() ?? null,
        status: row.status,
        title: row.title,
        type: row.type,
      }));
    });
  }

  markNotificationRead(
    organizationId: string,
    userId: string,
    notificationId: string,
  ): Promise<MutationResult<unknown>> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const membership = await tx.membership.findFirst({
        select: { id: true },
        where: { organizationId, status: 'ACTIVE', userId },
      });
      const notification = await tx.notification.findFirst({
        where: {
          channel: 'INTERNAL',
          id: notificationId,
          organizationId,
          OR: [
            { recipientMembershipId: null },
            ...(membership === null ? [] : [{ recipientMembershipId: membership.id }]),
          ],
        },
      });
      if (notification === null) return { kind: 'not_found' };
      const updated = await tx.notification.update({
        data: { readAt: notification.readAt ?? new Date() },
        where: { id: notification.id },
      });
      return {
        kind: 'success',
        value: { id: updated.id, readAt: updated.readAt?.toISOString() ?? null },
      };
    });
  }

  private async linkAlertsAndEvents(
    tx: Transaction,
    organizationId: string,
    incidentId: string,
    alerts: {
      id: string;
      events: { normalizedEventId: string }[];
    }[],
  ): Promise<void> {
    await tx.incidentAlert.createMany({
      data: alerts.map((alert) => ({ alertId: alert.id, incidentId, organizationId })),
    });
    const eventIds = [
      ...new Set(alerts.flatMap((alert) => alert.events.map((event) => event.normalizedEventId))),
    ];
    if (eventIds.length > 0) {
      await tx.incidentEvent.createMany({
        data: eventIds.map((normalizedEventId) => ({
          incidentId,
          normalizedEventId,
          organizationId,
        })),
        skipDuplicates: true,
      });
    }
    for (const alert of alerts) {
      await this.timeline(tx, {
        actorUserId: null,
        detail: `Alert ${alert.id} linked to the incident.`,
        incidentId,
        organizationId,
        title: 'Alert linked',
        type: 'ALERT_LINKED',
      });
    }
  }

  private async scheduleSla(
    tx: Transaction,
    incident: {
      id: string;
      organizationId: string;
      resolutionDueAt: Date;
      responseDueAt: Date;
    },
  ): Promise<void> {
    for (const [kind, availableAt] of [
      ['RESPONSE', incident.responseDueAt],
      ['RESOLUTION', incident.resolutionDueAt],
    ] as const) {
      await tx.outboxEvent.create({
        data: {
          aggregateId: incident.id,
          aggregateType: 'incident',
          availableAt,
          eventType: 'incident.sla_due.v1',
          occurredAt: new Date(),
          organizationId: incident.organizationId,
          payload: {
            incidentId: incident.id,
            kind,
            organizationId: incident.organizationId,
          },
        },
      });
    }
  }

  private async createNotification(
    tx: Transaction,
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
    const idempotencyKey = createHash('sha256')
      .update(
        `${input.type}:${input.incidentId}:${input.recipientMembershipId ?? 'broadcast'}:${input.channel}:${input.body}`,
      )
      .digest('hex');
    const notification = await tx.notification.upsert({
      create: { ...input, idempotencyKey },
      update: {},
      where: {
        organizationId_idempotencyKey: {
          idempotencyKey,
          organizationId: input.organizationId,
        },
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateId: notification.id,
        aggregateType: 'notification',
        eventType: 'notification.requested.v1',
        occurredAt: new Date(),
        organizationId: input.organizationId,
        payload: {
          notificationId: notification.id,
          organizationId: input.organizationId,
        },
      },
    });
  }

  private timeline(
    tx: Transaction,
    input: {
      actorUserId: string | null;
      detail: string;
      fromStatus?: IncidentStatusValue;
      incidentId: string;
      organizationId: string;
      title: string;
      toStatus?: IncidentStatusValue;
      type:
        | 'ALERT_LINKED'
        | 'ANALYSIS_UPDATED'
        | 'ASSIGNED'
        | 'COMMENT_ADDED'
        | 'CREATED'
        | 'EVIDENCE_ADDED'
        | 'STATUS_CHANGED';
    },
  ): Promise<unknown> {
    return tx.incidentTimelineEntry.create({
      data: {
        actorUserId: input.actorUserId,
        detail: input.detail,
        incidentId: input.incidentId,
        organizationId: input.organizationId,
        title: input.title,
        type: input.type,
        ...(input.fromStatus === undefined ? {} : { fromStatus: input.fromStatus }),
        ...(input.toStatus === undefined ? {} : { toStatus: input.toStatus }),
      },
    });
  }

  private audit(
    tx: Transaction,
    organizationId: string,
    userId: string,
    action: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<unknown> {
    return tx.eventRecord.create({
      data: {
        action,
        actorUserId: userId,
        correlationId: 'api-incident-command',
        metadata,
        organizationId,
        outcome: 'success',
        targetId,
        targetType: action.startsWith('sla_') ? 'sla_policy' : 'incident',
      },
    });
  }

  private async findSummaryOrThrow(
    tx: Transaction,
    organizationId: string,
    incidentId: string,
  ): Promise<IncidentSummary> {
    const row = await tx.incident.findFirst({
      include: summaryInclude,
      where: { id: incidentId, organizationId },
    });
    if (row === null) throw notFoundError('incident');
    return incidentSummary(row);
  }

  private async idempotent<T>(
    tx: Transaction,
    organizationId: string,
    context: IdempotencyContext,
    resourceType: string,
    operation: () => Promise<{ resourceId: string; value: T }>,
  ): Promise<{ replayed: boolean; value: T }> {
    const lockKey = `${organizationId}:${context.scope}:${context.keyHash}`;
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired`;
    let record = await tx.idempotencyRecord.findUnique({
      where: {
        organizationId_scope_keyHash: {
          keyHash: context.keyHash,
          organizationId,
          scope: context.scope,
        },
      },
    });
    if (record !== null && record.expiresAt <= new Date()) {
      await tx.idempotencyRecord.delete({ where: { id: record.id } });
      record = null;
    }
    if (record !== null) {
      if (record.requestHash !== context.requestHash) {
        throw new ApplicationError(
          'conflict',
          'The idempotency key was already used for another request.',
          409,
        );
      }
      if (record.status !== IdempotencyStatus.COMPLETED || record.responsePayload === null) {
        throw new ApplicationError('conflict', 'The idempotent request is still processing.', 409);
      }
      return { replayed: true, value: record.responsePayload as unknown as T };
    }
    const pending = await tx.idempotencyRecord.create({
      data: {
        actorUserId: context.actorUserId,
        expiresAt: new Date(Date.now() + 86_400_000),
        keyHash: context.keyHash,
        organizationId,
        requestHash: context.requestHash,
        scope: context.scope,
      },
    });
    const result = await operation();
    await tx.idempotencyRecord.update({
      data: {
        completedAt: new Date(),
        resourceId: result.resourceId,
        resourceType,
        responsePayload: result.value as Prisma.InputJsonObject,
        responseStatus: 201,
        status: IdempotencyStatus.COMPLETED,
      },
      where: { id: pending.id },
    });
    return { replayed: false, value: result.value };
  }
}

const summaryInclude = {
  _count: { select: { alerts: true } },
  assignedMembership: { include: { user: { select: { displayName: true } } } },
  primaryAsset: { select: { id: true, key: true, name: true } },
} satisfies Prisma.IncidentInclude;

function incidentSummary(row: {
  _count: { alerts: number };
  assignedMembership: { id: string; user: { displayName: string } } | null;
  createdAt: Date;
  firstDetectedAt: Date;
  firstRespondedAt: Date | null;
  id: string;
  key: string;
  primaryAsset: { id: string; key: string; name: string } | null;
  priority: IncidentPriorityValue;
  resolutionBreachedAt: Date | null;
  resolutionDueAt: Date;
  resolvedAt: Date | null;
  responseBreachedAt: Date | null;
  responseDueAt: Date;
  riskScore: unknown;
  severity: EventSeverityValue;
  status: IncidentStatusValue;
  title: string;
  updatedAt: Date;
  version: number;
}): IncidentSummary {
  const now = Date.now();
  return {
    alertCount: row._count.alerts,
    assignedMembership:
      row.assignedMembership === null
        ? null
        : {
            displayName: row.assignedMembership.user.displayName,
            id: row.assignedMembership.id,
          },
    createdAt: row.createdAt.toISOString(),
    firstDetectedAt: row.firstDetectedAt.toISOString(),
    id: row.id,
    key: row.key,
    primaryAsset: row.primaryAsset,
    priority: row.priority,
    resolutionDueAt: row.resolutionDueAt.toISOString(),
    responseDueAt: row.responseDueAt.toISOString(),
    riskScore: Number(row.riskScore),
    severity: row.severity,
    sla: {
      resolutionBreached:
        row.resolutionBreachedAt !== null ||
        (row.resolvedAt === null && row.resolutionDueAt.getTime() <= now),
      responseBreached:
        row.responseBreachedAt !== null ||
        (row.firstRespondedAt === null && row.responseDueAt.getTime() <= now),
    },
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function evidenceValue(evidence: {
  contentType: string;
  createdAt: Date;
  fileName: string;
  id: string;
  objectKey: string;
  rejectionReason: string | null;
  sha256: string;
  sizeBytes: number;
  status: IncidentEvidenceValue['status'];
  version: number;
}): IncidentEvidenceValue {
  return {
    contentType: evidence.contentType,
    createdAt: evidence.createdAt.toISOString(),
    fileName: evidence.fileName,
    id: evidence.id,
    objectKey: evidence.objectKey,
    rejectionReason: evidence.rejectionReason,
    sha256: evidence.sha256,
    sizeBytes: evidence.sizeBytes,
    status: evidence.status,
    version: evidence.version,
  };
}

function publicEvidence(evidence: Parameters<typeof evidenceValue>[0]) {
  const value = evidenceValue(evidence);
  return {
    contentType: value.contentType,
    createdAt: value.createdAt,
    fileName: value.fileName,
    id: value.id,
    rejectionReason: value.rejectionReason,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
    status: value.status,
    version: value.version,
  };
}

function highestSeverity(values: readonly EventSeverityValue[]): EventSeverityValue {
  const result = values.reduce<EventSeverityValue | undefined>((current, value) => {
    return current === undefined || SEVERITY_RANK[value] > SEVERITY_RANK[current] ? value : current;
  }, undefined);
  if (result === undefined) throw new Error('IncidentRequiresAlert');
  return result;
}

function incidentKey(id: string): string {
  return `INC-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function notFoundError(resource: string): ApplicationError {
  return new ApplicationError('not_found', `The ${resource} was not found.`, 404);
}
