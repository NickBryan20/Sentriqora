import { Inject, Injectable } from '@nestjs/common';

import { TenantPrismaExecutor } from '../../identity/infrastructure/prisma/tenant-prisma.executor';
import type { Prisma } from '../../generated/prisma/client';
import type {
  EventListFilters,
  EventRepositoryPort,
  IngestionReceiptSummary,
  NormalizedEventSummary,
} from '../application/ports/event-repository.port';

@Injectable()
export class PrismaEventRepository implements EventRepositoryPort {
  constructor(@Inject(TenantPrismaExecutor) private readonly executor: TenantPrismaExecutor) {}

  findReceipt(
    organizationId: string,
    userId: string,
    receiptId: string,
  ): Promise<IngestionReceiptSummary | null> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const receipt = await transaction.rawEvent.findFirst({
        include: { _count: { select: { normalizedEvents: true } } },
        where: { id: receiptId, organizationId },
      });
      if (receipt === null) {
        return null;
      }
      return {
        connectorId: receipt.connectorId,
        id: receipt.id,
        normalizedRecords: receipt._count.normalizedEvents,
        processedAt: receipt.processedAt?.toISOString() ?? null,
        receivedAt: receipt.receivedAt.toISOString(),
        recordCount: receipt.recordCount,
        rejectionCode: receipt.rejectionCode,
        status: receipt.status,
      };
    });
  }

  listEvents(
    organizationId: string,
    userId: string,
    filters: EventListFilters,
  ): Promise<NormalizedEventSummary[]> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const cursorCondition: Prisma.NormalizedEventWhereInput | undefined =
        filters.cursor === undefined
          ? undefined
          : {
              OR: [
                { occurredAt: { lt: filters.cursor.occurredAt } },
                { id: { lt: filters.cursor.id }, occurredAt: filters.cursor.occurredAt },
              ],
            };
      const where: Prisma.NormalizedEventWhereInput = {
        organizationId,
        ...(cursorCondition === undefined ? {} : { AND: [cursorCondition] }),
        ...(filters.assetId === undefined ? {} : { assetId: filters.assetId }),
        ...(filters.connectorId === undefined ? {} : { connectorId: filters.connectorId }),
        ...(filters.eventType === undefined ? {} : { eventType: filters.eventType }),
        ...(filters.search === undefined
          ? {}
          : { message: { contains: filters.search, mode: 'insensitive' as const } }),
        ...(filters.from === undefined && filters.to === undefined
          ? {}
          : {
              occurredAt: {
                ...(filters.from === undefined ? {} : { gte: filters.from }),
                ...(filters.to === undefined ? {} : { lte: filters.to }),
              },
            }),
        ...(filters.severity === undefined ? {} : { severity: filters.severity }),
      };
      const events = await transaction.normalizedEvent.findMany({
        include: {
          asset: { select: { id: true, key: true, name: true } },
          connector: { select: { id: true, key: true, name: true } },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: filters.limit,
        where,
      });
      return events.map((event) => ({
        asset: event.asset,
        attributes: asObject(event.attributes),
        connector: event.connector,
        eventType: event.eventType,
        fingerprint: event.fingerprint,
        id: event.id,
        message: event.message,
        occurredAt: event.occurredAt.toISOString(),
        receivedAt: event.receivedAt.toISOString(),
        severity: event.severity,
        sourceEventId: event.sourceEventId,
      }));
    });
  }
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
