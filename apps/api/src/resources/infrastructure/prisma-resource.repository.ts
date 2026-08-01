import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from '../../identity/application/application-error';
import { TenantPrismaExecutor } from '../../identity/infrastructure/prisma/tenant-prisma.executor';
import {
  AssetStatus,
  ConnectorStatus,
  IdempotencyStatus,
  type Prisma,
} from '../../generated/prisma/client';
import type {
  ApiKeySummary,
  AssetDependencySummary,
  AssetDetail,
  AssetSummary,
  ConnectorSummary,
  IdempotencyContext,
  IdempotentResult,
  IngressConnector,
  MutationResult,
  ResourceRepositoryPort,
} from '../application/ports/resource-repository.port';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class PrismaResourceRepository implements ResourceRepositoryPort {
  constructor(@Inject(TenantPrismaExecutor) private readonly executor: TenantPrismaExecutor) {}

  listAssets(organizationId: string, userId: string): Promise<AssetSummary[]> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const assets = await transaction.asset.findMany({
        orderBy: [{ status: 'asc' }, { criticality: 'desc' }, { name: 'asc' }],
        where: { organizationId },
      });
      return assets.map(mapAsset);
    });
  }

  findAsset(organizationId: string, userId: string, assetId: string): Promise<AssetDetail | null> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const asset = await transaction.asset.findFirst({
        include: {
          sourceDependencies: {
            include: { targetAsset: { select: { id: true, key: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
          targetDependencies: {
            include: { sourceAsset: { select: { id: true, key: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        where: { id: assetId, organizationId },
      });
      if (asset === null) {
        return null;
      }
      return {
        ...mapAsset(asset),
        dependedOnBy: asset.targetDependencies.map((dependency) => ({
          id: dependency.id,
          kind: dependency.kind,
          sourceAsset: dependency.sourceAsset,
        })),
        dependencies: asset.sourceDependencies.map(mapDependency),
      };
    });
  }

  async createAsset(
    input: Parameters<ResourceRepositoryPort['createAsset']>[0],
  ): Promise<IdempotentResult<AssetSummary>> {
    try {
      return await this.executor.run(
        { organizationId: input.organizationId, userId: input.userId },
        (transaction) =>
          this.idempotent(transaction, input.organizationId, input.idempotency, async () => {
            const asset = await transaction.asset.create({
              data: { ...input.asset, organizationId: input.organizationId },
            });
            await this.recordMutation(transaction, {
              action: 'asset.created',
              actorUserId: input.userId,
              aggregateId: asset.id,
              aggregateType: 'asset',
              audit: input.audit,
              organizationId: input.organizationId,
              payload: { assetId: asset.id, criticality: asset.criticality, type: asset.type },
            });
            return mapAsset(asset);
          }),
      );
    } catch (error) {
      this.translateConstraint(error, 'An asset with this key already exists.');
    }
  }

  updateAsset(
    input: Parameters<ResourceRepositoryPort['updateAsset']>[0],
  ): Promise<MutationResult<AssetSummary>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const updated = await transaction.asset.updateMany({
          data: { ...input.changes, version: { increment: 1 } },
          where: {
            id: input.assetId,
            organizationId: input.organizationId,
            version: input.version,
          },
        });
        if (updated.count === 0) {
          const exists = await transaction.asset.count({
            where: { id: input.assetId, organizationId: input.organizationId },
          });
          return { kind: exists === 0 ? 'not_found' : 'conflict' };
        }
        const asset = await transaction.asset.findUniqueOrThrow({ where: { id: input.assetId } });
        await this.recordMutation(transaction, {
          action: 'asset.updated',
          actorUserId: input.userId,
          aggregateId: asset.id,
          aggregateType: 'asset',
          audit: input.audit,
          organizationId: input.organizationId,
          payload: { assetId: asset.id, version: asset.version },
        });
        return { kind: 'success', value: mapAsset(asset) };
      },
    );
  }

  archiveAsset(input: Parameters<ResourceRepositoryPort['archiveAsset']>[0]): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const result = await transaction.asset.updateMany({
          data: { archivedAt: new Date(), status: AssetStatus.ARCHIVED, version: { increment: 1 } },
          where: { id: input.assetId, organizationId: input.organizationId },
        });
        if (result.count === 0) {
          return false;
        }
        await this.recordMutation(transaction, {
          action: 'asset.archived',
          actorUserId: input.userId,
          aggregateId: input.assetId,
          aggregateType: 'asset',
          audit: input.audit,
          organizationId: input.organizationId,
          payload: { assetId: input.assetId },
        });
        return true;
      },
    );
  }

  async addDependency(
    input: Parameters<ResourceRepositoryPort['addDependency']>[0],
  ): Promise<IdempotentResult<AssetDependencySummary>> {
    try {
      return await this.executor.run(
        { organizationId: input.organizationId, userId: input.userId },
        (transaction) =>
          this.idempotent(transaction, input.organizationId, input.idempotency, async () => {
            const sourceAndTarget = await transaction.asset.count({
              where: {
                id: { in: [input.dependency.sourceAssetId, input.dependency.targetAssetId] },
                organizationId: input.organizationId,
                status: AssetStatus.ACTIVE,
              },
            });
            if (sourceAndTarget !== 2) {
              throw new ApplicationError('not_found', 'An active asset was not found.', 404);
            }
            const dependency = await transaction.assetDependency.create({
              data: { ...input.dependency, organizationId: input.organizationId },
              include: { targetAsset: { select: { id: true, key: true, name: true } } },
            });
            await this.recordMutation(transaction, {
              action: 'asset.dependency.created',
              actorUserId: input.userId,
              aggregateId: dependency.id,
              aggregateType: 'asset_dependency',
              audit: input.audit,
              organizationId: input.organizationId,
              payload: {
                dependencyId: dependency.id,
                kind: dependency.kind,
                sourceAssetId: dependency.sourceAssetId,
                targetAssetId: dependency.targetAssetId,
              },
            });
            return mapDependency(dependency);
          }),
      );
    } catch (error) {
      this.translateConstraint(error, 'This asset dependency already exists.');
    }
  }

  removeDependency(
    input: Parameters<ResourceRepositoryPort['removeDependency']>[0],
  ): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const result = await transaction.assetDependency.deleteMany({
          where: {
            id: input.dependencyId,
            organizationId: input.organizationId,
            sourceAssetId: input.sourceAssetId,
          },
        });
        if (result.count === 0) {
          return false;
        }
        await this.recordMutation(transaction, {
          action: 'asset.dependency.deleted',
          actorUserId: input.userId,
          aggregateId: input.dependencyId,
          aggregateType: 'asset_dependency',
          audit: input.audit,
          organizationId: input.organizationId,
          payload: { dependencyId: input.dependencyId, sourceAssetId: input.sourceAssetId },
        });
        return true;
      },
    );
  }

  listConnectors(organizationId: string, userId: string): Promise<ConnectorSummary[]> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const connectors = await transaction.connector.findMany({
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        where: { organizationId },
      });
      return connectors.map(mapConnector);
    });
  }

  findConnector(
    organizationId: string,
    userId: string,
    connectorId: string,
  ): Promise<ConnectorSummary | null> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const connector = await transaction.connector.findFirst({
        where: { id: connectorId, organizationId },
      });
      return connector === null ? null : mapConnector(connector);
    });
  }

  async createConnector(
    input: Parameters<ResourceRepositoryPort['createConnector']>[0],
  ): Promise<IdempotentResult<ConnectorSummary>> {
    try {
      return await this.executor.run(
        { organizationId: input.organizationId, userId: input.userId },
        (transaction) =>
          this.idempotent(transaction, input.organizationId, input.idempotency, async () => {
            const connector = await transaction.connector.create({
              data: {
                ...input.connector,
                configuration: input.connector.configuration as Prisma.InputJsonValue,
                organizationId: input.organizationId,
              },
            });
            await this.recordMutation(transaction, {
              action: 'connector.created',
              actorUserId: input.userId,
              aggregateId: connector.id,
              aggregateType: 'connector',
              audit: input.audit,
              organizationId: input.organizationId,
              payload: { connectorId: connector.id, type: connector.type },
            });
            return mapConnector(connector);
          }),
      );
    } catch (error) {
      this.translateConstraint(error, 'A connector with this key already exists.');
    }
  }

  updateConnector(
    input: Parameters<ResourceRepositoryPort['updateConnector']>[0],
  ): Promise<MutationResult<ConnectorSummary>> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const { configuration, ...changes } = input.changes;
        const updated = await transaction.connector.updateMany({
          data: {
            ...changes,
            ...(configuration === undefined
              ? {}
              : { configuration: configuration as Prisma.InputJsonValue }),
            version: { increment: 1 },
          },
          where: {
            id: input.connectorId,
            organizationId: input.organizationId,
            version: input.version,
          },
        });
        if (updated.count === 0) {
          const exists = await transaction.connector.count({
            where: { id: input.connectorId, organizationId: input.organizationId },
          });
          return { kind: exists === 0 ? 'not_found' : 'conflict' };
        }
        const connector = await transaction.connector.findUniqueOrThrow({
          where: { id: input.connectorId },
        });
        await this.recordMutation(transaction, {
          action: 'connector.updated',
          actorUserId: input.userId,
          aggregateId: connector.id,
          aggregateType: 'connector',
          audit: input.audit,
          organizationId: input.organizationId,
          payload: {
            connectorId: connector.id,
            status: connector.status,
            version: connector.version,
          },
        });
        return { kind: 'success', value: mapConnector(connector) };
      },
    );
  }

  disableConnector(
    input: Parameters<ResourceRepositoryPort['disableConnector']>[0],
  ): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const result = await transaction.connector.updateMany({
          data: { status: ConnectorStatus.DISABLED, version: { increment: 1 } },
          where: { id: input.connectorId, organizationId: input.organizationId },
        });
        if (result.count === 0) {
          return false;
        }
        await Promise.all([
          transaction.apiKey.updateMany({
            data: { revokedAt: new Date() },
            where: {
              connectorId: input.connectorId,
              organizationId: input.organizationId,
              revokedAt: null,
            },
          }),
          transaction.webhookSecret.updateMany({
            data: { revokedAt: new Date() },
            where: {
              connectorId: input.connectorId,
              organizationId: input.organizationId,
              revokedAt: null,
            },
          }),
        ]);
        await this.recordMutation(transaction, {
          action: 'connector.disabled',
          actorUserId: input.userId,
          aggregateId: input.connectorId,
          aggregateType: 'connector',
          audit: input.audit,
          organizationId: input.organizationId,
          payload: { connectorId: input.connectorId },
        });
        return true;
      },
    );
  }

  rotateWebhookSecret(input: Parameters<ResourceRepositoryPort['rotateWebhookSecret']>[0]): Promise<
    IdempotentResult<{
      expiresPreviousAt: Date;
      id: string;
      prefix: string;
      replayEnvelope: { authTag: string; ciphertext: string; iv: string };
    }>
  > {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      (transaction) =>
        this.idempotent(transaction, input.organizationId, input.idempotency, async () => {
          const connector = await transaction.connector.findFirst({
            where: { id: input.connectorId, organizationId: input.organizationId },
          });
          if (connector === null) {
            throw new ApplicationError('not_found', 'The connector was not found.', 404);
          }
          await transaction.webhookSecret.updateMany({
            data: { expiresAt: input.expiresPreviousAt },
            where: {
              connectorId: input.connectorId,
              expiresAt: null,
              organizationId: input.organizationId,
              revokedAt: null,
            },
          });
          const secret = await transaction.webhookSecret.create({
            data: {
              connectorId: input.connectorId,
              createdByUserId: input.userId,
              encryptedSecret: input.secret.ciphertext,
              encryptionAuthTag: input.secret.authTag,
              encryptionIv: input.secret.iv,
              organizationId: input.organizationId,
              prefix: input.secret.prefix,
              secretHash: input.secret.hash,
            },
          });
          await this.recordMutation(transaction, {
            action: 'connector.webhook_secret.rotated',
            actorUserId: input.userId,
            aggregateId: input.connectorId,
            aggregateType: 'connector',
            audit: input.audit,
            organizationId: input.organizationId,
            payload: { connectorId: input.connectorId, secretId: secret.id },
          });
          return {
            expiresPreviousAt: input.expiresPreviousAt,
            id: secret.id,
            prefix: secret.prefix,
            replayEnvelope: input.replayEnvelope,
          };
        }),
    );
  }

  listApiKeys(
    organizationId: string,
    userId: string,
    connectorId: string,
  ): Promise<ApiKeySummary[] | null> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const connector = await transaction.connector.count({
        where: { id: connectorId, organizationId },
      });
      if (connector === 0) {
        return null;
      }
      const keys = await transaction.apiKey.findMany({
        orderBy: { createdAt: 'desc' },
        where: { connectorId, organizationId },
      });
      return keys.map(mapApiKey);
    });
  }

  createApiKey(input: Parameters<ResourceRepositoryPort['createApiKey']>[0]): Promise<
    IdempotentResult<{
      apiKey: ApiKeySummary;
      replayEnvelope: { authTag: string; ciphertext: string; iv: string };
    }>
  > {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      (transaction) =>
        this.idempotent(transaction, input.organizationId, input.idempotency, async () => {
          const connector = await transaction.connector.findFirst({
            where: { id: input.connectorId, organizationId: input.organizationId },
          });
          if (connector === null) {
            throw new ApplicationError('not_found', 'The connector was not found.', 404);
          }
          const apiKey = await transaction.apiKey.create({
            data: {
              ...input.apiKey,
              connectorId: input.connectorId,
              createdByUserId: input.userId,
              organizationId: input.organizationId,
            },
          });
          await this.recordMutation(transaction, {
            action: 'connector.api_key.created',
            actorUserId: input.userId,
            aggregateId: input.connectorId,
            aggregateType: 'connector',
            audit: input.audit,
            organizationId: input.organizationId,
            payload: { apiKeyId: apiKey.id, connectorId: input.connectorId, scopes: apiKey.scopes },
          });
          return { apiKey: mapApiKey(apiKey), replayEnvelope: input.replayEnvelope };
        }),
    );
  }

  revokeApiKey(input: Parameters<ResourceRepositoryPort['revokeApiKey']>[0]): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const result = await transaction.apiKey.updateMany({
          data: { revokedAt: new Date() },
          where: {
            connectorId: input.connectorId,
            id: input.apiKeyId,
            organizationId: input.organizationId,
            revokedAt: null,
          },
        });
        if (result.count === 0) {
          return false;
        }
        await this.recordMutation(transaction, {
          action: 'connector.api_key.revoked',
          actorUserId: input.userId,
          aggregateId: input.connectorId,
          aggregateType: 'connector',
          audit: input.audit,
          organizationId: input.organizationId,
          payload: { apiKeyId: input.apiKeyId, connectorId: input.connectorId },
        });
        return true;
      },
    );
  }

  findIngressConnector(
    organizationId: string,
    connectorId: string,
    now: Date,
  ): Promise<IngressConnector | null> {
    return this.executor.run({ organizationId, userId: null }, async (transaction) => {
      const connector = await transaction.connector.findFirst({
        include: {
          apiKeys: {
            select: { expiresAt: true, id: true, prefix: true, scopes: true, tokenHash: true },
            where: {
              AND: [{ revokedAt: null }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
            },
          },
          webhookSecrets: {
            select: {
              encryptedSecret: true,
              encryptionAuthTag: true,
              encryptionIv: true,
              expiresAt: true,
              id: true,
            },
            where: {
              AND: [
                { revokedAt: null },
                { validFrom: { lte: now } },
                { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
              ],
            },
          },
        },
        where: { id: connectorId, organizationId },
      });
      if (connector === null) {
        return null;
      }
      return {
        apiKeys: connector.apiKeys,
        id: connector.id,
        status: connector.status,
        type: connector.type,
        webhookSecrets: connector.webhookSecrets.map((secret) => ({
          encryptedSecret: {
            authTag: secret.encryptionAuthTag,
            ciphertext: secret.encryptedSecret,
            iv: secret.encryptionIv,
          },
          expiresAt: secret.expiresAt,
          id: secret.id,
        })),
      };
    });
  }

  recordIngress(
    input: Parameters<ResourceRepositoryPort['recordIngress']>[0],
  ): ReturnType<ResourceRepositoryPort['recordIngress']> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: null },
      (transaction) =>
        this.idempotent(transaction, input.organizationId, input.idempotency, async () => {
          const connector = await transaction.connector.updateMany({
            data: { lastSeenAt: input.receivedAt },
            where: {
              id: input.connectorId,
              organizationId: input.organizationId,
              status: ConnectorStatus.ACTIVE,
            },
          });
          if (connector.count === 0) {
            throw new ApplicationError(
              'authentication_failed',
              'Invalid connector credentials.',
              401,
            );
          }
          if (input.apiKeyId !== null) {
            await transaction.apiKey.updateMany({
              data: { lastUsedAt: input.receivedAt },
              where: { id: input.apiKeyId, organizationId: input.organizationId, revokedAt: null },
            });
          }

          const deduplicationLock = `${input.organizationId}:${input.connectorId}:${input.deduplicationKey}`;
          await transaction.$queryRaw`
            SELECT 1 AS locked
            FROM (
              SELECT pg_advisory_xact_lock(hashtextextended(${deduplicationLock}, 0)) AS acquired
            ) AS deduplication_lock
          `;
          const existing = await transaction.rawEvent.findUnique({
            where: {
              organizationId_connectorId_deduplicationKey: {
                connectorId: input.connectorId,
                deduplicationKey: input.deduplicationKey,
                organizationId: input.organizationId,
              },
            },
          });
          if (existing !== null) {
            return {
              accepted: true as const,
              duplicate: true,
              receiptId: existing.id,
              receivedAt: existing.receivedAt.toISOString(),
              status: existing.status,
            };
          }

          const rawEvent = await transaction.rawEvent.create({
            data: {
              connectorId: input.connectorId,
              contentType: input.contentType,
              correlationId: input.correlationId,
              deduplicationKey: input.deduplicationKey,
              encryptedPayload: input.payload.ciphertext,
              encryptionAuthTag: input.payload.authTag,
              encryptionIv: input.payload.iv,
              format: input.payload.format,
              organizationId: input.organizationId,
              payloadHash: input.payload.hash,
              payloadSize: input.payload.size,
              receivedAt: input.receivedAt,
              recordCount: input.payload.recordCount,
              retentionUntil: input.retentionUntil,
              sourceEventId: input.payload.sourceEventId,
            },
          });
          await transaction.eventRecord.create({
            data: {
              action: 'raw_event.received',
              correlationId: input.correlationId,
              metadata: {
                authentication: input.authentication,
                connectorId: input.connectorId,
                contentType: input.contentType,
                format: input.payload.format,
                recordCount: input.payload.recordCount,
                requestHash: input.idempotency.requestHash,
              },
              organizationId: input.organizationId,
              outcome: 'success',
              targetId: rawEvent.id,
              targetType: 'raw_event',
            },
          });
          await transaction.outboxEvent.create({
            data: {
              aggregateId: rawEvent.id,
              aggregateType: 'raw_event',
              eventType: 'raw_event.received.v1',
              occurredAt: input.receivedAt,
              organizationId: input.organizationId,
              payload: {
                connectorId: input.connectorId,
                correlationId: input.correlationId,
                organizationId: input.organizationId,
                rawEventId: rawEvent.id,
              },
            },
          });
          return {
            accepted: true as const,
            duplicate: false,
            receiptId: rawEvent.id,
            receivedAt: rawEvent.receivedAt.toISOString(),
            status: rawEvent.status,
          };
        }),
    );
  }

  private async idempotent<T>(
    transaction: Transaction,
    organizationId: string,
    context: IdempotencyContext,
    operation: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const lockKey = `${organizationId}:${context.scope}:${context.keyHash}`;
    await transaction.$queryRaw`
      SELECT 1 AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired
    `;
    let existing = await transaction.idempotencyRecord.findUnique({
      where: {
        organizationId_scope_keyHash: {
          keyHash: context.keyHash,
          organizationId,
          scope: context.scope,
        },
      },
    });
    if (existing !== null && existing.expiresAt <= new Date()) {
      await transaction.idempotencyRecord.delete({ where: { id: existing.id } });
      existing = null;
    }
    if (existing !== null) {
      if (existing.requestHash !== context.requestHash) {
        throw new ApplicationError(
          'conflict',
          'The idempotency key was already used for another request.',
          409,
        );
      }
      if (existing.status !== IdempotencyStatus.COMPLETED || existing.responsePayload === null) {
        throw new ApplicationError('conflict', 'The idempotent request is still processing.', 409);
      }
      return { replayed: true, value: existing.responsePayload as T };
    }

    const record = await transaction.idempotencyRecord.create({
      data: {
        actorUserId: context.actorUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        keyHash: context.keyHash,
        organizationId,
        requestHash: context.requestHash,
        scope: context.scope,
      },
    });
    const value = await operation();
    await transaction.idempotencyRecord.update({
      data: {
        completedAt: new Date(),
        responsePayload: toJson(value),
        responseStatus: 200,
        status: IdempotencyStatus.COMPLETED,
      },
      where: { id: record.id },
    });
    return { replayed: false, value };
  }

  private async recordMutation(
    transaction: Transaction,
    input: {
      action: string;
      actorUserId: string;
      aggregateId: string;
      aggregateType: string;
      audit: { correlationId: string; ipHash?: string };
      organizationId: string;
      payload: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    const occurredAt = new Date();
    await transaction.eventRecord.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        correlationId: input.audit.correlationId,
        ...(input.audit.ipHash === undefined ? {} : { ipHash: input.audit.ipHash }),
        metadata: input.payload,
        organizationId: input.organizationId,
        outcome: 'success',
        targetId: input.aggregateId,
        targetType: input.aggregateType,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        eventType: `${input.action}.v1`,
        occurredAt,
        organizationId: input.organizationId,
        payload: input.payload,
      },
    });
  }

  private translateConstraint(error: unknown, message: string): never {
    if (isPrismaError(error, 'P2002')) {
      throw new ApplicationError('conflict', message, 409);
    }
    if (isPrismaError(error, 'P2003')) {
      throw new ApplicationError('validation_failed', 'A referenced resource is invalid.', 400);
    }
    throw error;
  }
}

function mapAsset(asset: {
  archivedAt: Date | null;
  createdAt: Date;
  criticality: AssetSummary['criticality'];
  description: string;
  id: string;
  key: string;
  name: string;
  organizationId: string;
  ownerMembershipId: string | null;
  status: AssetSummary['status'];
  tags: string[];
  type: AssetSummary['type'];
  updatedAt: Date;
  version: number;
}): AssetSummary {
  return { ...asset };
}

function mapDependency(dependency: {
  createdAt: Date;
  description: string;
  id: string;
  kind: AssetDependencySummary['kind'];
  sourceAssetId: string;
  targetAsset: { id: string; key: string; name: string };
  targetAssetId: string;
}): AssetDependencySummary {
  return { ...dependency };
}

function mapConnector(connector: {
  configuration: Prisma.JsonValue;
  createdAt: Date;
  description: string;
  id: string;
  key: string;
  lastSeenAt: Date | null;
  name: string;
  organizationId: string;
  status: ConnectorSummary['status'];
  type: ConnectorSummary['type'];
  updatedAt: Date;
  version: number;
}): ConnectorSummary {
  return { ...connector, configuration: connector.configuration as Record<string, unknown> };
}

function mapApiKey(apiKey: {
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  lastUsedAt: Date | null;
  name: string;
  prefix: string;
  revokedAt: Date | null;
  scopes: string[];
}): ApiKeySummary {
  return { ...apiKey };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  );
}
