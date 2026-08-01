import type { AuthPrincipal, EventSeverityValue } from '@aegisflow/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../identity/application/application-error';
import {
  EVENT_REPOSITORY_PORT,
  type EventCursor,
  type EventRepositoryPort,
} from './ports/event-repository.port';

export interface ListEventsQuery {
  assetId?: string;
  connectorId?: string;
  cursor?: string;
  eventType?: string;
  from?: string;
  limit?: number;
  search?: string;
  severity?: EventSeverityValue;
  to?: string;
}

@Injectable()
export class EventUseCases {
  constructor(@Inject(EVENT_REPOSITORY_PORT) private readonly repository: EventRepositoryPort) {}

  async listEvents(principal: AuthPrincipal, organizationId: string, query: ListEventsQuery) {
    this.assertTenant(principal, organizationId);
    const from = query.from === undefined ? undefined : new Date(query.from);
    const to = query.to === undefined ? undefined : new Date(query.to);
    if (
      from !== undefined &&
      to !== undefined &&
      (from > to || to.getTime() - from.getTime() > 31 * 24 * 60 * 60_000)
    ) {
      throw new ApplicationError(
        'validation_failed',
        'The event query time range is invalid or exceeds 31 days.',
        400,
      );
    }
    const events = await this.repository.listEvents(organizationId, principal.userId, {
      limit: query.limit ?? 50,
      ...(query.assetId === undefined ? {} : { assetId: query.assetId }),
      ...(query.connectorId === undefined ? {} : { connectorId: query.connectorId }),
      ...(query.cursor === undefined ? {} : { cursor: decodeCursor(query.cursor) }),
      ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
      ...(from === undefined ? {} : { from }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.severity === undefined ? {} : { severity: query.severity }),
      ...(to === undefined ? {} : { to }),
    });
    const last = events.at(-1);
    return {
      data: events,
      nextCursor:
        events.length === (query.limit ?? 50) && last !== undefined
          ? encodeCursor({ id: last.id, occurredAt: new Date(last.occurredAt) })
          : null,
    };
  }

  async getReceipt(principal: AuthPrincipal, organizationId: string, receiptId: string) {
    this.assertTenant(principal, organizationId);
    const receipt = await this.repository.findReceipt(organizationId, principal.userId, receiptId);
    if (receipt === null) {
      throw new ApplicationError('not_found', 'The ingestion receipt was not found.', 404);
    }
    return receipt;
  }

  private assertTenant(principal: AuthPrincipal, organizationId: string): void {
    if (principal.organizationId !== organizationId) {
      throw new ApplicationError('forbidden', 'The operation is not permitted.', 403);
    }
  }
}

function decodeCursor(value: string): EventCursor {
  try {
    const candidate = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('id' in candidate) ||
      !('occurredAt' in candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.occurredAt !== 'string'
    ) {
      throw new Error('invalid cursor shape');
    }
    const occurredAt = new Date(candidate.occurredAt);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        candidate.id,
      ) ||
      Number.isNaN(occurredAt.getTime())
    ) {
      throw new Error('invalid cursor value');
    }
    return { id: candidate.id, occurredAt };
  } catch {
    throw new ApplicationError('validation_failed', 'The pagination cursor is invalid.', 400);
  }
}

function encodeCursor(cursor: EventCursor): string {
  return Buffer.from(
    JSON.stringify({ id: cursor.id, occurredAt: cursor.occurredAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}
