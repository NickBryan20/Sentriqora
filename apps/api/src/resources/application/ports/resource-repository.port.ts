import type {
  AssetCriticalityValue,
  AssetDependencyKindValue,
  AssetStatusValue,
  AssetTypeValue,
  ConnectorStatusValue,
  ConnectorTypeValue,
} from '@aegisflow/contracts';

import type { RequestAudit } from '../../../identity/application/ports/identity-repository.port';
import type { EncryptedValue } from '../../../identity/application/ports/identity-security.port';

export const RESOURCE_REPOSITORY_PORT = Symbol('RESOURCE_REPOSITORY_PORT');

export interface IdempotencyContext {
  actorUserId: string | null;
  keyHash: string;
  requestHash: string;
  scope: string;
}

export interface AssetSummary {
  archivedAt: Date | null;
  createdAt: Date;
  criticality: AssetCriticalityValue;
  description: string;
  id: string;
  key: string;
  name: string;
  organizationId: string;
  ownerMembershipId: string | null;
  status: AssetStatusValue;
  tags: string[];
  type: AssetTypeValue;
  updatedAt: Date;
  version: number;
}

export interface AssetDependencySummary {
  createdAt: Date;
  description: string;
  id: string;
  kind: AssetDependencyKindValue;
  sourceAssetId: string;
  targetAsset: { id: string; key: string; name: string };
  targetAssetId: string;
}

export interface AssetDetail extends AssetSummary {
  dependencies: AssetDependencySummary[];
  dependedOnBy: {
    id: string;
    kind: AssetDependencyKindValue;
    sourceAsset: { id: string; key: string; name: string };
  }[];
}

export interface ConnectorSummary {
  configuration: Record<string, unknown>;
  createdAt: Date;
  description: string;
  id: string;
  key: string;
  lastSeenAt: Date | null;
  name: string;
  organizationId: string;
  status: ConnectorStatusValue;
  type: ConnectorTypeValue;
  updatedAt: Date;
  version: number;
}

export interface ApiKeySummary {
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  lastUsedAt: Date | null;
  name: string;
  prefix: string;
  revokedAt: Date | null;
  scopes: string[];
}

export interface WebhookCredential {
  encryptedSecret: EncryptedValue;
  expiresAt: Date | null;
  id: string;
}

export interface IngressConnector {
  apiKeys: {
    expiresAt: Date | null;
    id: string;
    prefix: string;
    scopes: string[];
    tokenHash: string;
  }[];
  id: string;
  status: ConnectorStatusValue;
  type: ConnectorTypeValue;
  webhookSecrets: WebhookCredential[];
}

export interface MutationConflict {
  kind: 'conflict';
}

export interface MutationNotFound {
  kind: 'not_found';
}

export interface MutationSuccess<T> {
  kind: 'success';
  value: T;
}

export type MutationResult<T> = MutationConflict | MutationNotFound | MutationSuccess<T>;
export interface IdempotentResult<T> {
  replayed: boolean;
  value: T;
}

export interface ResourceRepositoryPort {
  addDependency(input: {
    audit: RequestAudit;
    dependency: {
      description: string;
      kind: AssetDependencyKindValue;
      sourceAssetId: string;
      targetAssetId: string;
    };
    idempotency: IdempotencyContext;
    organizationId: string;
    userId: string;
  }): Promise<IdempotentResult<AssetDependencySummary>>;
  archiveAsset(input: {
    assetId: string;
    audit: RequestAudit;
    organizationId: string;
    userId: string;
  }): Promise<boolean>;
  createApiKey(input: {
    apiKey: {
      expiresAt: Date | null;
      name: string;
      prefix: string;
      scopes: string[];
      tokenHash: string;
    };
    audit: RequestAudit;
    connectorId: string;
    idempotency: IdempotencyContext;
    organizationId: string;
    replayEnvelope: EncryptedValue;
    userId: string;
  }): Promise<IdempotentResult<{ apiKey: ApiKeySummary; replayEnvelope: EncryptedValue }>>;
  createAsset(input: {
    asset: {
      criticality: AssetCriticalityValue;
      description: string;
      key: string;
      name: string;
      ownerMembershipId: string | null;
      tags: string[];
      type: AssetTypeValue;
    };
    audit: RequestAudit;
    idempotency: IdempotencyContext;
    organizationId: string;
    userId: string;
  }): Promise<IdempotentResult<AssetSummary>>;
  createConnector(input: {
    audit: RequestAudit;
    connector: {
      configuration: Record<string, unknown>;
      description: string;
      key: string;
      name: string;
      type: ConnectorTypeValue;
    };
    idempotency: IdempotencyContext;
    organizationId: string;
    userId: string;
  }): Promise<IdempotentResult<ConnectorSummary>>;
  disableConnector(input: {
    audit: RequestAudit;
    connectorId: string;
    organizationId: string;
    userId: string;
  }): Promise<boolean>;
  findAsset(organizationId: string, userId: string, assetId: string): Promise<AssetDetail | null>;
  findConnector(
    organizationId: string,
    userId: string,
    connectorId: string,
  ): Promise<ConnectorSummary | null>;
  findIngressConnector(
    organizationId: string,
    connectorId: string,
    now: Date,
  ): Promise<IngressConnector | null>;
  listApiKeys(
    organizationId: string,
    userId: string,
    connectorId: string,
  ): Promise<ApiKeySummary[] | null>;
  listAssets(organizationId: string, userId: string): Promise<AssetSummary[]>;
  listConnectors(organizationId: string, userId: string): Promise<ConnectorSummary[]>;
  recordIngress(input: {
    apiKeyId: string | null;
    authentication: 'api_key' | 'webhook_signature';
    connectorId: string;
    contentType: string;
    idempotency: IdempotencyContext;
    organizationId: string;
    receivedAt: Date;
  }): Promise<IdempotentResult<{ accepted: true; receiptId: string; receivedAt: string }>>;
  removeDependency(input: {
    audit: RequestAudit;
    dependencyId: string;
    organizationId: string;
    sourceAssetId: string;
    userId: string;
  }): Promise<boolean>;
  revokeApiKey(input: {
    apiKeyId: string;
    audit: RequestAudit;
    connectorId: string;
    organizationId: string;
    userId: string;
  }): Promise<boolean>;
  rotateWebhookSecret(input: {
    audit: RequestAudit;
    connectorId: string;
    expiresPreviousAt: Date;
    idempotency: IdempotencyContext;
    organizationId: string;
    replayEnvelope: EncryptedValue;
    secret: EncryptedValue & { hash: string; prefix: string };
    userId: string;
  }): Promise<
    IdempotentResult<{
      expiresPreviousAt: Date;
      id: string;
      prefix: string;
      replayEnvelope: EncryptedValue;
    }>
  >;
  updateAsset(input: {
    assetId: string;
    audit: RequestAudit;
    changes: {
      criticality?: AssetCriticalityValue;
      description?: string;
      name?: string;
      ownerMembershipId?: string | null;
      tags?: string[];
    };
    organizationId: string;
    userId: string;
    version: number;
  }): Promise<MutationResult<AssetSummary>>;
  updateConnector(input: {
    audit: RequestAudit;
    changes: {
      configuration?: Record<string, unknown>;
      description?: string;
      name?: string;
      status?: ConnectorStatusValue;
    };
    connectorId: string;
    organizationId: string;
    userId: string;
    version: number;
  }): Promise<MutationResult<ConnectorSummary>>;
}
