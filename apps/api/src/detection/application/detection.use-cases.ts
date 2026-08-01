import type { AlertStatusValue, AuthPrincipal, EventSeverityValue } from '@aegisflow/contracts';
import {
  createDetectionRuleSchema,
  setDetectionRuleEnabledSchema,
  suppressAlertSchema,
  triageAlertSchema,
  updateDetectionRuleSchema,
} from '@aegisflow/contracts';
import { IdempotencyKey } from '@aegisflow/domain';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';

import { ApplicationError } from '../../identity/application/application-error';
import {
  DETECTION_REPOSITORY_PORT,
  type AlertCursor,
  type DetectionRepositoryPort,
} from './ports/detection-repository.port';

export interface DetectionRequestContext {
  correlationId: string;
  ipAddress: string;
}

@Injectable()
export class DetectionUseCases {
  constructor(
    @Inject(DETECTION_REPOSITORY_PORT) private readonly repository: DetectionRepositoryPort,
  ) {}

  listRules(principal: AuthPrincipal, organizationId: string) {
    this.assertTenant(principal, organizationId);
    return this.repository.listRules(organizationId, principal.userId);
  }

  createRule(
    principal: AuthPrincipal,
    organizationId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
    context: DetectionRequestContext,
  ) {
    this.assertTenant(principal, organizationId);
    const input = createDetectionRuleSchema.parse(candidate);
    const key = IdempotencyKey.create(idempotencyKey);
    return this.repository.createRule({
      audit: { correlationId: context.correlationId, ipHash: this.hash(context.ipAddress) },
      idempotency: {
        actorUserId: principal.userId,
        keyHash: this.hash(key.value),
        requestHash: this.hash(JSON.stringify(input)),
        scope: 'detection-rule.create',
      },
      organizationId,
      rule: input,
      userId: principal.userId,
    });
  }

  async updateRule(
    principal: AuthPrincipal,
    organizationId: string,
    ruleId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    const parsed = updateDetectionRuleSchema.parse(candidate);
    const { version } = parsed;
    const changes = Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) => key !== 'version' && value !== undefined),
    );
    return this.unwrap(
      await this.repository.updateRule({
        changes,
        organizationId,
        ruleId,
        userId: principal.userId,
        version,
      }),
      'rule',
    );
  }

  async setRuleEnabled(
    principal: AuthPrincipal,
    organizationId: string,
    ruleId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    const input = setDetectionRuleEnabledSchema.parse(candidate);
    return this.unwrap(
      await this.repository.setRuleEnabled({
        ...input,
        organizationId,
        ruleId,
        userId: principal.userId,
      }),
      'rule',
    );
  }

  async listAlerts(
    principal: AuthPrincipal,
    organizationId: string,
    query: {
      assignedMembershipId?: string;
      cursor?: string;
      limit?: number;
      search?: string;
      severity?: EventSeverityValue;
      status?: AlertStatusValue;
    },
  ) {
    this.assertTenant(principal, organizationId);
    const alerts = await this.repository.listAlerts(organizationId, principal.userId, {
      limit: query.limit ?? 50,
      ...(query.assignedMembershipId === undefined
        ? {}
        : { assignedMembershipId: query.assignedMembershipId }),
      ...(query.cursor === undefined ? {} : { cursor: decodeCursor(query.cursor) }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.severity === undefined ? {} : { severity: query.severity }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
    const last = alerts.at(-1);
    return {
      data: alerts,
      nextCursor:
        alerts.length === (query.limit ?? 50) && last !== undefined
          ? encodeCursor({ id: last.id, lastSeenAt: new Date(last.lastSeenAt) })
          : null,
    };
  }

  async getAlert(principal: AuthPrincipal, organizationId: string, alertId: string) {
    this.assertTenant(principal, organizationId);
    const alert = await this.repository.findAlert(organizationId, principal.userId, alertId);
    if (alert === null) throw new ApplicationError('not_found', 'The alert was not found.', 404);
    return alert;
  }

  async getAlertGraph(principal: AuthPrincipal, organizationId: string, alertId: string) {
    this.assertTenant(principal, organizationId);
    const graph = await this.repository.getAlertGraph(organizationId, principal.userId, alertId);
    if (graph === null) throw new ApplicationError('not_found', 'The alert was not found.', 404);
    return graph;
  }

  async triageAlert(
    principal: AuthPrincipal,
    organizationId: string,
    alertId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    const input = triageAlertSchema.parse(candidate);
    return this.unwrap(
      await this.repository.triageAlert({
        alertId,
        organizationId,
        status: input.status,
        userId: principal.userId,
        version: input.version,
        ...(input.assignedMembershipId === undefined
          ? {}
          : { assignedMembershipId: input.assignedMembershipId }),
      }),
      'alert',
    );
  }

  async suppressAlert(
    principal: AuthPrincipal,
    organizationId: string,
    alertId: string,
    candidate: unknown,
  ) {
    this.assertTenant(principal, organizationId);
    const input = suppressAlertSchema.parse(candidate);
    const suppressedUntil = new Date(input.suppressedUntil);
    const now = Date.now();
    if (
      suppressedUntil.getTime() <= now ||
      suppressedUntil.getTime() > now + 30 * 24 * 60 * 60_000
    ) {
      throw new ApplicationError(
        'validation_failed',
        'Suppression must end within the next 30 days.',
        400,
      );
    }
    return this.unwrap(
      await this.repository.suppressAlert({
        alertId,
        organizationId,
        reason: input.reason,
        suppressedUntil,
        userId: principal.userId,
        version: input.version,
      }),
      'alert',
    );
  }

  private unwrap<T>(
    result: { kind: 'conflict' } | { kind: 'not_found' } | { kind: 'success'; value: T },
    resource: string,
  ): T {
    if (result.kind === 'not_found')
      throw new ApplicationError('not_found', `The ${resource} was not found.`, 404);
    if (result.kind === 'conflict')
      throw new ApplicationError(
        'conflict',
        `The ${resource} was modified by another request.`,
        409,
      );
    return result.value;
  }

  private assertTenant(principal: AuthPrincipal, organizationId: string): void {
    if (principal.organizationId !== organizationId)
      throw new ApplicationError('forbidden', 'The operation is not permitted.', 403);
  }

  private hash(value: string): string {
    const pepper = process.env.AUTH_TOKEN_PEPPER;
    return pepper === undefined
      ? createHash('sha256').update(value).digest('hex')
      : createHmac('sha256', pepper).update(value).digest('hex');
  }
}

function decodeCursor(value: string): AlertCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      id?: unknown;
      lastSeenAt?: unknown;
    };
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.lastSeenAt !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(parsed.id)
    )
      throw new Error('invalid');
    const lastSeenAt = new Date(parsed.lastSeenAt);
    if (Number.isNaN(lastSeenAt.getTime())) throw new Error('invalid');
    return { id: parsed.id, lastSeenAt };
  } catch {
    throw new ApplicationError('validation_failed', 'The pagination cursor is invalid.', 400);
  }
}

function encodeCursor(cursor: AlertCursor): string {
  return Buffer.from(
    JSON.stringify({ id: cursor.id, lastSeenAt: cursor.lastSeenAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}
