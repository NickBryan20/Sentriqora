import type { AuthPrincipal } from '@aegisflow/contracts';
import {
  createApiKeySchema,
  createAssetDependencySchema,
  createAssetSchema,
  createConnectorSchema,
  rotateWebhookSecretSchema,
  updateAssetSchema,
  updateConnectorSchema,
} from '@aegisflow/contracts';
import { EventPayloadValidationError, inspectIngressPayload } from '@aegisflow/contracts';
import { IdempotencyKey, ResourceKey, ResourcePolicy } from '@aegisflow/domain';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { ApplicationError } from '../../identity/application/application-error';
import { recordAcceptedIngress, recordRejectedIngress } from '../../metrics/ingestion.metrics';
import type { RequestAudit } from '../../identity/application/ports/identity-repository.port';
import {
  IDENTITY_SECURITY_PORT,
  type EncryptedValue,
  type IdentitySecurityPort,
} from '../../identity/application/ports/identity-security.port';
import {
  INGRESS_PROTECTION_PORT,
  type IngressProtectionPort,
} from './ports/ingress-protection.port';
import {
  RESOURCE_REPOSITORY_PORT,
  type AssetDetail,
  type AssetSummary,
  type ApiKeySummary,
  type ConnectorSummary,
  type IdempotencyContext,
  type IdempotentResult,
  type ResourceRepositoryPort,
} from './ports/resource-repository.port';

export interface ResourceRequestContext {
  correlationId: string;
  ipAddress: string;
}

export interface IngressRequest {
  apiKey: string | undefined;
  connectorId: string;
  correlationId: string;
  contentType: string;
  idempotencyKey: string | undefined;
  ipAddress: string;
  organizationId: string;
  rawBody: Buffer;
  signature: string | undefined;
  timestamp: string | undefined;
}

@Injectable()
export class ResourceUseCases {
  private readonly policy = new ResourcePolicy();

  constructor(
    @Inject(RESOURCE_REPOSITORY_PORT) private readonly repository: ResourceRepositoryPort,
    @Inject(IDENTITY_SECURITY_PORT) private readonly security: IdentitySecurityPort,
    @Inject(INGRESS_PROTECTION_PORT) private readonly ingressProtection: IngressProtectionPort,
  ) {}

  listAssets(principal: AuthPrincipal, organizationId: string): Promise<AssetSummary[]> {
    this.assertTenant(principal, organizationId);
    return this.repository.listAssets(organizationId, principal.userId);
  }

  async getAsset(
    principal: AuthPrincipal,
    organizationId: string,
    assetId: string,
  ): Promise<AssetDetail> {
    this.assertTenant(principal, organizationId);
    const asset = await this.repository.findAsset(organizationId, principal.userId, assetId);
    if (asset === null) {
      throw new ApplicationError('not_found', 'The asset was not found.', 404);
    }
    return asset;
  }

  createAsset(
    principal: AuthPrincipal,
    organizationId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
    context: ResourceRequestContext,
  ): Promise<IdempotentResult<AssetSummary>> {
    this.assertTenant(principal, organizationId);
    const input = createAssetSchema.parse(candidate);
    const key = ResourceKey.create(input.key);
    return this.repository.createAsset({
      asset: {
        criticality: input.criticality,
        description: input.description,
        key: key.value,
        name: input.name,
        ownerMembershipId: input.ownerMembershipId ?? null,
        tags: [...new Set(input.tags)].sort(),
        type: input.type,
      },
      audit: this.audit(context),
      idempotency: this.idempotency(principal.userId, `asset.create`, idempotencyKey, input),
      organizationId,
      userId: principal.userId,
    });
  }

  async updateAsset(
    principal: AuthPrincipal,
    organizationId: string,
    assetId: string,
    candidate: unknown,
    context: ResourceRequestContext,
  ): Promise<AssetSummary> {
    this.assertTenant(principal, organizationId);
    const input = updateAssetSchema.parse(candidate);
    const { version } = input;
    const changes = {
      ...(input.criticality === undefined ? {} : { criticality: input.criticality }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.ownerMembershipId === undefined
        ? {}
        : { ownerMembershipId: input.ownerMembershipId }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
    };
    const result = await this.repository.updateAsset({
      assetId,
      audit: this.audit(context),
      changes,
      organizationId,
      userId: principal.userId,
      version,
    });
    if (result.kind === 'not_found') {
      throw new ApplicationError('not_found', 'The asset was not found.', 404);
    }
    if (result.kind === 'conflict') {
      throw new ApplicationError('conflict', 'The asset was modified by another request.', 409);
    }
    return result.value;
  }

  async archiveAsset(
    principal: AuthPrincipal,
    organizationId: string,
    assetId: string,
    context: ResourceRequestContext,
  ): Promise<void> {
    this.assertTenant(principal, organizationId);
    const found = await this.repository.archiveAsset({
      assetId,
      audit: this.audit(context),
      organizationId,
      userId: principal.userId,
    });
    if (!found) {
      throw new ApplicationError('not_found', 'The asset was not found.', 404);
    }
  }

  addDependency(
    principal: AuthPrincipal,
    organizationId: string,
    sourceAssetId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
    context: ResourceRequestContext,
  ) {
    this.assertTenant(principal, organizationId);
    const input = createAssetDependencySchema.parse(candidate);
    this.policy.assertDependency(sourceAssetId, input.targetAssetId);
    return this.repository.addDependency({
      audit: this.audit(context),
      dependency: { ...input, sourceAssetId },
      idempotency: this.idempotency(
        principal.userId,
        `asset.${sourceAssetId}.dependency.create`,
        idempotencyKey,
        input,
      ),
      organizationId,
      userId: principal.userId,
    });
  }

  async removeDependency(
    principal: AuthPrincipal,
    organizationId: string,
    sourceAssetId: string,
    dependencyId: string,
    context: ResourceRequestContext,
  ): Promise<void> {
    this.assertTenant(principal, organizationId);
    const found = await this.repository.removeDependency({
      audit: this.audit(context),
      dependencyId,
      organizationId,
      sourceAssetId,
      userId: principal.userId,
    });
    if (!found) {
      throw new ApplicationError('not_found', 'The asset dependency was not found.', 404);
    }
  }

  listConnectors(principal: AuthPrincipal, organizationId: string): Promise<ConnectorSummary[]> {
    this.assertTenant(principal, organizationId);
    return this.repository.listConnectors(organizationId, principal.userId);
  }

  async getConnector(
    principal: AuthPrincipal,
    organizationId: string,
    connectorId: string,
  ): Promise<ConnectorSummary> {
    this.assertTenant(principal, organizationId);
    const connector = await this.repository.findConnector(
      organizationId,
      principal.userId,
      connectorId,
    );
    if (connector === null) {
      throw new ApplicationError('not_found', 'The connector was not found.', 404);
    }
    return connector;
  }

  createConnector(
    principal: AuthPrincipal,
    organizationId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
    context: ResourceRequestContext,
  ): Promise<IdempotentResult<ConnectorSummary>> {
    this.assertTenant(principal, organizationId);
    const input = createConnectorSchema.parse(candidate);
    const key = ResourceKey.create(input.key);
    const configuration = this.policy.validateConnectorConfiguration(
      input.type,
      input.configuration,
    );
    return this.repository.createConnector({
      audit: this.audit(context),
      connector: {
        configuration: { ...configuration },
        description: input.description,
        key: key.value,
        name: input.name,
        type: input.type,
      },
      idempotency: this.idempotency(principal.userId, 'connector.create', idempotencyKey, input),
      organizationId,
      userId: principal.userId,
    });
  }

  async updateConnector(
    principal: AuthPrincipal,
    organizationId: string,
    connectorId: string,
    candidate: unknown,
    context: ResourceRequestContext,
  ): Promise<ConnectorSummary> {
    this.assertTenant(principal, organizationId);
    const input = updateConnectorSchema.parse(candidate);
    const current = await this.getConnector(principal, organizationId, connectorId);
    const { version } = input;
    const changes = {
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.configuration === undefined
        ? {}
        : {
            configuration: {
              ...this.policy.validateConnectorConfiguration(current.type, input.configuration),
            },
          }),
    };
    const result = await this.repository.updateConnector({
      audit: this.audit(context),
      changes,
      connectorId,
      organizationId,
      userId: principal.userId,
      version,
    });
    if (result.kind === 'not_found') {
      throw new ApplicationError('not_found', 'The connector was not found.', 404);
    }
    if (result.kind === 'conflict') {
      throw new ApplicationError('conflict', 'The connector was modified by another request.', 409);
    }
    return result.value;
  }

  async disableConnector(
    principal: AuthPrincipal,
    organizationId: string,
    connectorId: string,
    context: ResourceRequestContext,
  ): Promise<void> {
    this.assertTenant(principal, organizationId);
    const found = await this.repository.disableConnector({
      audit: this.audit(context),
      connectorId,
      organizationId,
      userId: principal.userId,
    });
    if (!found) {
      throw new ApplicationError('not_found', 'The connector was not found.', 404);
    }
  }

  async rotateWebhookSecret(
    principal: AuthPrincipal,
    organizationId: string,
    connectorId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
    context: ResourceRequestContext,
  ) {
    this.assertTenant(principal, organizationId);
    const input = rotateWebhookSecretSchema.parse(candidate);
    const connector = await this.getConnector(principal, organizationId, connectorId);
    if (connector.type !== 'WEBHOOK' && connector.type !== 'GITHUB') {
      throw new ApplicationError(
        'validation_failed',
        'Webhook secrets are only available for webhook and GitHub connectors.',
        400,
      );
    }
    const issued = this.security.generateOpaqueToken();
    const plainText = `whsec_${issued.plainText}`;
    const encrypted = this.security.encrypt(plainText);
    const now = new Date();
    const result = await this.repository.rotateWebhookSecret({
      audit: this.audit(context),
      connectorId,
      expiresPreviousAt: new Date(now.getTime() + input.gracePeriodSeconds * 1_000),
      idempotency: this.idempotency(
        principal.userId,
        `connector.${connectorId}.webhook-secret.rotate`,
        idempotencyKey,
        input,
      ),
      organizationId,
      replayEnvelope: encrypted,
      secret: {
        ...encrypted,
        hash: this.security.hashOpaqueToken(plainText),
        prefix: plainText.slice(0, 12),
      },
      userId: principal.userId,
    });
    return {
      replayed: result.replayed,
      value: {
        expiresPreviousAt: result.value.expiresPreviousAt,
        id: result.value.id,
        prefix: result.value.prefix,
        secret: this.security.decrypt(result.value.replayEnvelope),
      },
    };
  }

  async listApiKeys(
    principal: AuthPrincipal,
    organizationId: string,
    connectorId: string,
  ): Promise<ApiKeySummary[]> {
    this.assertTenant(principal, organizationId);
    const keys = await this.repository.listApiKeys(organizationId, principal.userId, connectorId);
    if (keys === null) {
      throw new ApplicationError('not_found', 'The connector was not found.', 404);
    }
    return keys;
  }

  async createApiKey(
    principal: AuthPrincipal,
    organizationId: string,
    connectorId: string,
    candidate: unknown,
    idempotencyKey: string | undefined,
    context: ResourceRequestContext,
  ) {
    this.assertTenant(principal, organizationId);
    const input = createApiKeySchema.parse(candidate);
    const now = new Date();
    const expiresAt =
      input.expiresAt === null || input.expiresAt === undefined ? null : new Date(input.expiresAt);
    const scopes = this.policy.validateApiKey(input.scopes, expiresAt, now);
    const issued = this.security.generateOpaqueToken();
    const plainText = `sqk_${issued.plainText}`;
    const replayEnvelope = this.security.encrypt(plainText);
    const result = await this.repository.createApiKey({
      apiKey: {
        expiresAt,
        name: input.name,
        prefix: plainText.slice(0, 16),
        scopes,
        tokenHash: this.security.hashOpaqueToken(plainText),
      },
      audit: this.audit(context),
      connectorId,
      idempotency: this.idempotency(
        principal.userId,
        `connector.${connectorId}.api-key.create`,
        idempotencyKey,
        input,
      ),
      organizationId,
      replayEnvelope,
      userId: principal.userId,
    });
    return {
      replayed: result.replayed,
      value: {
        ...result.value.apiKey,
        token: this.security.decrypt(result.value.replayEnvelope),
      },
    };
  }

  async revokeApiKey(
    principal: AuthPrincipal,
    organizationId: string,
    connectorId: string,
    apiKeyId: string,
    context: ResourceRequestContext,
  ): Promise<void> {
    this.assertTenant(principal, organizationId);
    const found = await this.repository.revokeApiKey({
      apiKeyId,
      audit: this.audit(context),
      connectorId,
      organizationId,
      userId: principal.userId,
    });
    if (!found) {
      throw new ApplicationError('not_found', 'The API key was not found.', 404);
    }
  }

  async receiveIngress(input: IngressRequest) {
    if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > 1_048_576) {
      throw new ApplicationError('validation_failed', 'The ingress payload size is invalid.', 400);
    }
    await this.ingressProtection.assertAllowed({
      connectorId: input.connectorId,
      credential: input.apiKey ?? input.signature ?? 'missing',
      ipAddress: input.ipAddress,
      organizationId: input.organizationId,
    });
    const now = new Date();
    const connector = await this.repository.findIngressConnector(
      input.organizationId,
      input.connectorId,
      now,
    );
    if (connector === null || connector.status !== 'ACTIVE') {
      throw new ApplicationError('authentication_failed', 'Invalid connector credentials.', 401);
    }

    let apiKeyId: string | null = null;
    let authentication: 'api_key' | 'webhook_signature';
    if (connector.type === 'WEBHOOK' || connector.type === 'GITHUB') {
      this.verifyWebhookSignature(
        connector.webhookSecrets.map((credential) => credential.encryptedSecret),
        input.rawBody,
        input.signature,
        input.timestamp,
        now,
      );
      authentication = 'webhook_signature';
    } else {
      const apiKey = this.verifyApiKey(connector.apiKeys, input.apiKey);
      apiKeyId = apiKey.id;
      authentication = 'api_key';
    }

    let inspected;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody);
      inspected = inspectIngressPayload(connector.type, input.contentType, text);
    } catch (error) {
      if (error instanceof EventPayloadValidationError || error instanceof TypeError) {
        recordRejectedIngress(
          error instanceof EventPayloadValidationError ? error.code : 'invalid_text_encoding',
        );
        throw new ApplicationError('validation_failed', 'The event payload is invalid.', 400);
      }
      throw error;
    }
    const payloadHash = this.digest(input.rawBody);
    const deduplicationKey = this.digest(
      inspected.sourceEventId === null
        ? `payload:${payloadHash}`
        : `source-event:${inspected.sourceEventId}`,
    );
    const encryptedPayload = this.security.encrypt(inspected.text);

    const result = await this.repository.recordIngress({
      apiKeyId,
      authentication,
      connectorId: input.connectorId,
      contentType: input.contentType.slice(0, 120),
      correlationId: input.correlationId,
      deduplicationKey,
      idempotency: this.idempotency(
        null,
        `connector.${input.connectorId}.ingress`,
        input.idempotencyKey,
        { bodyHash: this.digest(input.rawBody), contentType: input.contentType },
      ),
      organizationId: input.organizationId,
      payload: {
        ...encryptedPayload,
        format: inspected.format,
        hash: payloadHash,
        recordCount: inspected.recordCount,
        size: input.rawBody.byteLength,
        sourceEventId: inspected.sourceEventId,
      },
      receivedAt: now,
      retentionUntil: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    recordAcceptedIngress({
      authentication,
      duplicate: result.value.duplicate,
      format: inspected.format,
      payloadBytes: input.rawBody.byteLength,
    });
    return result;
  }

  private assertTenant(principal: AuthPrincipal, organizationId: string): void {
    if (principal.organizationId !== organizationId) {
      throw new ApplicationError('forbidden', 'The operation is not permitted.', 403);
    }
  }

  private audit(context: ResourceRequestContext): RequestAudit {
    return {
      correlationId: context.correlationId,
      ipHash: this.security.hashFingerprint(context.ipAddress),
    };
  }

  private digest(value: Buffer | string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private idempotency(
    actorUserId: string | null,
    scope: string,
    candidate: string | undefined,
    request: unknown,
  ): IdempotencyContext {
    const key = IdempotencyKey.create(candidate);
    return {
      actorUserId,
      keyHash: this.security.hashOpaqueToken(key.value),
      requestHash: this.digest(stableStringify(request)),
      scope,
    };
  }

  private verifyApiKey(
    keys: { id: string; scopes: string[]; tokenHash: string }[],
    candidate: string | undefined,
  ): { id: string } {
    const tokenHash = this.security.hashOpaqueToken(candidate ?? 'missing');
    const key = keys.find(
      (entry) =>
        entry.scopes.includes('connector.ingest') && safeHexEqual(entry.tokenHash, tokenHash),
    );
    if (key === undefined) {
      throw new ApplicationError('authentication_failed', 'Invalid connector credentials.', 401);
    }
    return key;
  }

  private verifyWebhookSignature(
    credentials: EncryptedValue[],
    rawBody: Buffer,
    signature: string | undefined,
    timestamp: string | undefined,
    now: Date,
  ): void {
    const timestampSeconds = Number(timestamp);
    const provided = signature?.startsWith('sha256=') ? signature.slice(7) : '';
    if (
      !Number.isInteger(timestampSeconds) ||
      Math.abs(Math.floor(now.getTime() / 1_000) - timestampSeconds) > 300 ||
      !/^[a-f0-9]{64}$/u.test(provided)
    ) {
      throw new ApplicationError('authentication_failed', 'Invalid connector credentials.', 401);
    }
    const signedPayload = Buffer.concat([Buffer.from(`${timestampSeconds}.`, 'utf8'), rawBody]);
    const verified = credentials.some((credential) => {
      const secret = this.security.decrypt(credential);
      const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
      return safeHexEqual(expected, provided);
    });
    if (!verified) {
      throw new ApplicationError('authentication_failed', 'Invalid connector credentials.', 401);
    }
  }
}

function safeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return (
    leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}
