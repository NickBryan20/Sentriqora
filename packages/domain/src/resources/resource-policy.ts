import {
  InvalidApiKeyPolicyError,
  InvalidConnectorConfigurationError,
  InvalidDependencyError,
} from './resource-errors';

export const API_KEY_SCOPES = ['connector.ingest', 'connector.health'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export type ConnectorConfigurationValue = boolean | number | string | null | readonly string[];
export type ConnectorConfiguration = Readonly<Record<string, ConnectorConfigurationValue>>;

const CONFIGURATION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/u;
const SECRET_KEY_PATTERN = /(authorization|credential|password|private|secret|token|apiKey)/iu;
const OUTBOUND_LOCATION_KEY_PATTERN = /(baseUrl|endpoint|host|uri|url)/iu;
const URL_VALUE_PATTERN = /^(?:file|ftp|gopher|https?):\/\//iu;
const GITHUB_REPOSITORY_PATTERN = /^[a-zA-Z0-9_.-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/u;

export class ResourcePolicy {
  assertDependency(sourceAssetId: string, targetAssetId: string): void {
    if (sourceAssetId === targetAssetId) {
      throw new InvalidDependencyError();
    }
  }

  validateConnectorConfiguration(
    connectorType: string,
    candidate: Readonly<Record<string, unknown>>,
  ): ConnectorConfiguration {
    const entries = Object.entries(candidate);
    const reasons: string[] = [];
    if (entries.length > 20) {
      reasons.push('too_many_properties');
    }
    for (const [key, value] of entries) {
      if (!CONFIGURATION_KEY_PATTERN.test(key)) {
        reasons.push('invalid_property_name');
      }
      if (SECRET_KEY_PATTERN.test(key)) {
        reasons.push('secret_property_forbidden');
      }
      if (OUTBOUND_LOCATION_KEY_PATTERN.test(key)) {
        reasons.push('outbound_location_forbidden');
      }
      if (!this.isConfigurationValue(value)) {
        reasons.push('invalid_property_value');
      }
      if (typeof value === 'string' && value.length > 500) {
        reasons.push('property_value_too_long');
      }
      if (typeof value === 'string' && URL_VALUE_PATTERN.test(value.trim())) {
        reasons.push('outbound_location_forbidden');
      }
      if (Array.isArray(value) && (value.length > 20 || value.some((item) => item.length > 120))) {
        reasons.push('property_array_too_large');
      }
    }
    const repository = candidate['repository'];
    if (
      connectorType === 'GITHUB' &&
      (typeof repository !== 'string' || !GITHUB_REPOSITORY_PATTERN.test(repository))
    ) {
      reasons.push('github_repository_required');
    }
    if (reasons.length > 0) {
      throw new InvalidConnectorConfigurationError([...new Set(reasons)]);
    }
    return candidate as ConnectorConfiguration;
  }

  validateApiKey(scopes: readonly string[], expiresAt: Date | null, now: Date): ApiKeyScope[] {
    const uniqueScopes = [...new Set(scopes)];
    const reasons: string[] = [];
    if (
      uniqueScopes.length === 0 ||
      uniqueScopes.some((scope) => !API_KEY_SCOPES.includes(scope as ApiKeyScope))
    ) {
      reasons.push('invalid_scope');
    }
    if (expiresAt !== null) {
      const maximumExpiry = now.getTime() + 366 * 24 * 60 * 60_000;
      if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > maximumExpiry) {
        reasons.push('invalid_expiry');
      }
    }
    if (reasons.length > 0) {
      throw new InvalidApiKeyPolicyError(reasons);
    }
    return uniqueScopes as ApiKeyScope[];
  }

  private isConfigurationValue(value: unknown): value is ConnectorConfigurationValue {
    return (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      typeof value === 'string' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    );
  }
}
