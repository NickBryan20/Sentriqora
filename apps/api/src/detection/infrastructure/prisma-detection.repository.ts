import { detectionRuleConditionSchema, type CorrelationDimensionValue } from '@aegisflow/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../identity/application/application-error';
import type { Prisma } from '../../generated/prisma/client';
import { IdempotencyStatus } from '../../generated/prisma/enums';
import { TenantPrismaExecutor } from '../../identity/infrastructure/prisma/tenant-prisma.executor';
import type {
  AlertListFilters,
  AlertSummary,
  DetectionRepositoryPort,
  DetectionRuleSummary,
  MutationResult,
} from '../application/ports/detection-repository.port';

type Transaction = Prisma.TransactionClient;
type RuleRow = Awaited<ReturnType<Transaction['detectionRule']['findFirst']>>;

@Injectable()
export class PrismaDetectionRepository implements DetectionRepositoryPort {
  constructor(@Inject(TenantPrismaExecutor) private readonly executor: TenantPrismaExecutor) {}

  listRules(organizationId: string, userId: string): Promise<DetectionRuleSummary[]> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const rules = await tx.detectionRule.findMany({
        orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
        where: { organizationId },
      });
      return rules.map(ruleSummary);
    });
  }

  createRule(
    input: Parameters<DetectionRepositoryPort['createRule']>[0],
  ): ReturnType<DetectionRepositoryPort['createRule']> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        const lockKey = `${input.organizationId}:${input.idempotency.scope}:${input.idempotency.keyHash}`;
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired`;
        let record = await tx.idempotencyRecord.findUnique({
          where: {
            organizationId_scope_keyHash: {
              keyHash: input.idempotency.keyHash,
              organizationId: input.organizationId,
              scope: input.idempotency.scope,
            },
          },
        });
        if (record !== null && record.expiresAt <= new Date()) {
          await tx.idempotencyRecord.delete({ where: { id: record.id } });
          record = null;
        }
        if (record !== null) {
          if (record.requestHash !== input.idempotency.requestHash)
            throw new ApplicationError(
              'conflict',
              'The idempotency key was already used for another request.',
              409,
            );
          if (record.status !== IdempotencyStatus.COMPLETED || record.resourceId === null)
            throw new ApplicationError(
              'conflict',
              'The idempotent request is still processing.',
              409,
            );
          const existing = await tx.detectionRule.findFirst({
            where: { id: record.resourceId, organizationId: input.organizationId },
          });
          if (existing === null)
            throw new ApplicationError('conflict', 'The idempotent resource is unavailable.', 409);
          return { replayed: true, value: ruleSummary(existing) };
        }
        const pending = await tx.idempotencyRecord.create({
          data: {
            actorUserId: input.userId,
            expiresAt: new Date(Date.now() + 86_400_000),
            keyHash: input.idempotency.keyHash,
            organizationId: input.organizationId,
            requestHash: input.idempotency.requestHash,
            scope: input.idempotency.scope,
          },
        });
        let created;
        try {
          created = await tx.detectionRule.create({
            data: {
              ...input.rule,
              condition: input.rule.condition as Prisma.InputJsonObject,
              correlationDimensions: input.rule.correlationDimensions,
              createdByUserId: input.userId,
              organizationId: input.organizationId,
              updatedByUserId: input.userId,
              versions: {
                create: {
                  condition: input.rule.condition as Prisma.InputJsonObject,
                  correlationDimensions: input.rule.correlationDimensions,
                  deduplicationWindowSeconds: input.rule.deduplicationWindowSeconds,
                  description: input.rule.description,
                  name: input.rule.name,
                  organizationId: input.organizationId,
                  severity: input.rule.severity,
                  threshold: input.rule.threshold,
                  version: 1,
                  windowSeconds: input.rule.windowSeconds,
                },
              },
            },
          });
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ApplicationError(
              'conflict',
              'A detection rule with that key already exists.',
              409,
            );
          throw error;
        }
        const value = ruleSummary(created);
        await tx.idempotencyRecord.update({
          data: {
            completedAt: new Date(),
            resourceId: created.id,
            resourceType: 'detection_rule',
            responsePayload: value as unknown as Prisma.InputJsonObject,
            responseStatus: 201,
            status: IdempotencyStatus.COMPLETED,
          },
          where: { id: pending.id },
        });
        await this.audit(
          tx,
          input.organizationId,
          input.userId,
          input.audit,
          'detection_rule.created',
          'detection_rule',
          created.id,
          { enabled: created.enabled, key: created.key, version: created.version },
        );
        return { replayed: false, value };
      },
    );
  }

  updateRule(
    input: Parameters<DetectionRepositoryPort['updateRule']>[0],
  ): Promise<MutationResult<DetectionRuleSummary>> {
    return this.mutateRule(
      input.organizationId,
      input.userId,
      input.ruleId,
      input.version,
      input.changes,
    );
  }

  setRuleEnabled(
    input: Parameters<DetectionRepositoryPort['setRuleEnabled']>[0],
  ): Promise<MutationResult<DetectionRuleSummary>> {
    return this.mutateRule(input.organizationId, input.userId, input.ruleId, input.version, {
      enabled: input.enabled,
    });
  }

  private mutateRule(
    organizationId: string,
    userId: string,
    ruleId: string,
    version: number,
    changes: Record<string, unknown>,
  ): Promise<MutationResult<DetectionRuleSummary>> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const current = await tx.detectionRule.findFirst({ where: { id: ruleId, organizationId } });
      if (current === null) return { kind: 'not_found' };
      if (current.version !== version) return { kind: 'conflict' };
      const mutation = await tx.detectionRule.updateMany({
        data: {
          ...changes,
          ...(changes['condition'] === undefined
            ? {}
            : { condition: changes['condition'] as Prisma.InputJsonObject }),
          updatedByUserId: userId,
          version: { increment: 1 },
        } as Prisma.DetectionRuleUncheckedUpdateManyInput,
        where: { id: current.id, organizationId, version },
      });
      if (mutation.count !== 1) return { kind: 'conflict' };
      const updated = await tx.detectionRule.findFirst({
        where: { id: current.id, organizationId },
      });
      if (updated === null) return { kind: 'not_found' };
      await tx.detectionRuleVersion.create({
        data: {
          condition: updated.condition as Prisma.InputJsonObject,
          correlationDimensions: updated.correlationDimensions,
          deduplicationWindowSeconds: updated.deduplicationWindowSeconds,
          description: updated.description,
          name: updated.name,
          organizationId,
          ruleId,
          severity: updated.severity,
          threshold: updated.threshold,
          version: updated.version,
          windowSeconds: updated.windowSeconds,
        },
      });
      await this.audit(
        tx,
        organizationId,
        userId,
        { correlationId: 'api-detection-rule', ipHash: '' },
        'detection_rule.updated',
        'detection_rule',
        ruleId,
        { enabled: updated.enabled, version: updated.version },
      );
      return { kind: 'success', value: ruleSummary(updated) };
    });
  }

  listAlerts(
    organizationId: string,
    userId: string,
    filters: AlertListFilters,
  ): Promise<AlertSummary[]> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const cursor =
        filters.cursor === undefined
          ? undefined
          : {
              OR: [
                { lastSeenAt: { lt: filters.cursor.lastSeenAt } },
                { id: { lt: filters.cursor.id }, lastSeenAt: filters.cursor.lastSeenAt },
              ],
            };
      const alerts = await tx.alert.findMany({
        include: {
          asset: { select: { id: true, key: true, name: true } },
          rule: { select: { id: true, key: true, name: true } },
        },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        take: filters.limit,
        where: {
          organizationId,
          ...(cursor === undefined ? {} : { AND: [cursor] }),
          ...(filters.assignedMembershipId === undefined
            ? {}
            : { assignedMembershipId: filters.assignedMembershipId }),
          ...(filters.search === undefined
            ? {}
            : {
                OR: [
                  { title: { contains: filters.search, mode: 'insensitive' } },
                  { description: { contains: filters.search, mode: 'insensitive' } },
                ],
              }),
          ...(filters.severity === undefined ? {} : { severity: filters.severity }),
          ...(filters.status === undefined ? {} : { status: filters.status }),
        },
      });
      return alerts.map(alertSummary);
    });
  }

  findAlert(
    organizationId: string,
    userId: string,
    alertId: string,
  ): ReturnType<DetectionRepositoryPort['findAlert']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const alert = await tx.alert.findFirst({
        include: {
          asset: { select: { id: true, key: true, name: true } },
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
            take: 100,
          },
          rule: { select: { id: true, key: true, name: true } },
        },
        where: { id: alertId, organizationId },
      });
      if (alert === null) return null;
      return {
        ...alertSummary(alert),
        description: alert.description,
        events: alert.events.map(({ normalizedEvent }) => ({
          ...normalizedEvent,
          occurredAt: normalizedEvent.occurredAt.toISOString(),
        })),
        firstSeenAt: alert.firstSeenAt.toISOString(),
        suppressionReason: alert.suppressionReason,
      };
    });
  }

  getAlertGraph(
    organizationId: string,
    userId: string,
    alertId: string,
  ): ReturnType<DetectionRepositoryPort['getAlertGraph']> {
    return this.executor.run({ organizationId, userId }, async (tx) => {
      const exists = await tx.alert.findFirst({
        select: { id: true },
        where: { id: alertId, organizationId },
      });
      if (exists === null) return null;
      const edges = await tx.alertCorrelationEdge.findMany({
        include: {
          sourceAlert: {
            include: {
              asset: { select: { id: true, key: true, name: true } },
              rule: { select: { id: true, key: true, name: true } },
            },
          },
          targetAlert: {
            include: {
              asset: { select: { id: true, key: true, name: true } },
              rule: { select: { id: true, key: true, name: true } },
            },
          },
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 200,
        where: { organizationId, OR: [{ sourceAlertId: alertId }, { targetAlertId: alertId }] },
      });
      const nodes = new Map<string, AlertSummary>();
      for (const edge of edges) {
        nodes.set(edge.sourceAlert.id, alertSummary(edge.sourceAlert));
        nodes.set(edge.targetAlert.id, alertSummary(edge.targetAlert));
      }
      if (!nodes.has(alertId)) {
        const root = await tx.alert.findFirst({
          include: {
            asset: { select: { id: true, key: true, name: true } },
            rule: { select: { id: true, key: true, name: true } },
          },
          where: { id: alertId, organizationId },
        });
        if (root !== null) nodes.set(root.id, alertSummary(root));
      }
      return {
        edges: edges.map((edge) => ({
          dimension: edge.dimension as CorrelationDimensionValue,
          id: edge.id,
          source: edge.sourceAlertId,
          target: edge.targetAlertId,
          weight: edge.weight,
        })),
        nodes: [...nodes.values()],
      };
    });
  }

  triageAlert(
    input: Parameters<DetectionRepositoryPort['triageAlert']>[0],
  ): Promise<MutationResult<AlertSummary>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (tx) => {
        if (input.assignedMembershipId !== undefined && input.assignedMembershipId !== null) {
          const membership = await tx.membership.findFirst({
            where: {
              id: input.assignedMembershipId,
              organizationId: input.organizationId,
              status: 'ACTIVE',
            },
          });
          if (membership === null) return { kind: 'not_found' };
        }
        return this.updateAlert(
          tx,
          input.organizationId,
          input.userId,
          input.alertId,
          input.version,
          {
            ...(input.assignedMembershipId === undefined
              ? {}
              : { assignedMembershipId: input.assignedMembershipId }),
            ...(input.status === 'ACKNOWLEDGED' ? { acknowledgedAt: new Date() } : {}),
            status: input.status,
            suppressedUntil: null,
            suppressionReason: null,
          },
          'alert.triaged',
        );
      },
    );
  }

  suppressAlert(
    input: Parameters<DetectionRepositoryPort['suppressAlert']>[0],
  ): Promise<MutationResult<AlertSummary>> {
    return this.executor.run({ organizationId: input.organizationId, userId: input.userId }, (tx) =>
      this.updateAlert(
        tx,
        input.organizationId,
        input.userId,
        input.alertId,
        input.version,
        {
          status: 'SUPPRESSED',
          suppressedUntil: input.suppressedUntil,
          suppressionReason: input.reason,
        },
        'alert.suppressed',
      ),
    );
  }

  private async updateAlert(
    tx: Transaction,
    organizationId: string,
    userId: string,
    alertId: string,
    version: number,
    data: Prisma.AlertUncheckedUpdateManyInput,
    action: 'alert.suppressed' | 'alert.triaged',
  ): Promise<MutationResult<AlertSummary>> {
    const existing = await tx.alert.findFirst({
      select: { id: true, version: true },
      where: { id: alertId, organizationId },
    });
    if (existing === null) return { kind: 'not_found' };
    if (existing.version !== version) return { kind: 'conflict' };
    const mutation = await tx.alert.updateMany({
      data: { ...data, version: { increment: 1 } },
      where: { id: alertId, organizationId, version },
    });
    if (mutation.count !== 1) return { kind: 'conflict' };
    const result = await tx.alert.findFirst({
      include: {
        asset: { select: { id: true, key: true, name: true } },
        rule: { select: { id: true, key: true, name: true } },
      },
      where: { id: alertId, organizationId },
    });
    if (result === null) return { kind: 'not_found' };
    await this.audit(
      tx,
      organizationId,
      userId,
      { correlationId: 'api-alert-command', ipHash: '' },
      action,
      'alert',
      alertId,
      { status: result.status, version: result.version },
    );
    return { kind: 'success', value: alertSummary(result) };
  }

  private audit(
    tx: Transaction,
    organizationId: string,
    userId: string,
    context: { correlationId: string; ipHash: string },
    action: string,
    targetType: 'alert' | 'detection_rule',
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<unknown> {
    return tx.eventRecord.create({
      data: {
        action,
        actorUserId: userId,
        correlationId: context.correlationId.slice(0, 80),
        ...(context.ipHash.length === 0 ? {} : { ipHash: context.ipHash }),
        metadata,
        organizationId,
        outcome: 'success',
        targetId,
        targetType,
      },
    });
  }
}

function ruleSummary(rule: NonNullable<RuleRow>): DetectionRuleSummary {
  return {
    condition: detectionRuleConditionSchema.parse(rule.condition),
    correlationDimensions: rule.correlationDimensions as CorrelationDimensionValue[],
    createdAt: rule.createdAt.toISOString(),
    deduplicationWindowSeconds: rule.deduplicationWindowSeconds,
    description: rule.description,
    enabled: rule.enabled,
    id: rule.id,
    key: rule.key,
    name: rule.name,
    severity: rule.severity,
    threshold: rule.threshold,
    updatedAt: rule.updatedAt.toISOString(),
    version: rule.version,
    windowSeconds: rule.windowSeconds,
  };
}

function alertSummary(alert: {
  asset: { id: string; key: string; name: string } | null;
  assignedMembershipId: string | null;
  correlationKey: string;
  createdAt: Date;
  id: string;
  lastSeenAt: Date;
  occurrenceCount: number;
  riskScore: unknown;
  rule: { id: string; key: string; name: string };
  severity: AlertSummary['severity'];
  status: AlertSummary['status'];
  suppressedUntil: Date | null;
  title: string;
  version: number;
}): AlertSummary {
  return {
    asset: alert.asset,
    assignedMembershipId: alert.assignedMembershipId,
    correlationKey: alert.correlationKey,
    createdAt: alert.createdAt.toISOString(),
    id: alert.id,
    lastSeenAt: alert.lastSeenAt.toISOString(),
    occurrenceCount: alert.occurrenceCount,
    riskScore: Number(alert.riskScore),
    rule: alert.rule,
    severity: alert.severity,
    status: alert.status,
    suppressedUntil: alert.suppressedUntil?.toISOString() ?? null,
    title: alert.title,
    version: alert.version,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
