import {
  IdempotencyKey,
  InvalidApiKeyPolicyError,
  InvalidConnectorConfigurationError,
  InvalidDependencyError,
  InvalidIdempotencyKeyError,
  InvalidResourceKeyError,
  ResourceKey,
  ResourcePolicy,
} from '../src';
import { describe, expect, it } from 'vitest';

describe('resource domain policies', () => {
  const policy = new ResourcePolicy();

  it('normalizes stable resource keys and validates idempotency keys', () => {
    expect(ResourceKey.create(' Payments-API ').value).toBe('payments-api');
    expect(IdempotencyKey.create('phase2:create:0001').value).toBe('phase2:create:0001');
    expect(() => ResourceKey.create('../invalid')).toThrow(InvalidResourceKeyError);
    expect(() => IdempotencyKey.create('short')).toThrow(InvalidIdempotencyKeyError);
  });

  it('rejects self dependencies', () => {
    expect(() => policy.assertDependency('asset-a', 'asset-a')).toThrow(InvalidDependencyError);
    expect(() => policy.assertDependency('asset-a', 'asset-b')).not.toThrow();
  });

  it('keeps connector configuration shallow and free of secrets or arbitrary URLs', () => {
    expect(
      policy.validateConnectorConfiguration('GITHUB', {
        branch: 'main',
        repository: 'NickBryan20/Sentriqora',
      }),
    ).toEqual({ branch: 'main', repository: 'NickBryan20/Sentriqora' });
    expect(() =>
      policy.validateConnectorConfiguration('WEBHOOK', { secretToken: 'must-not-live-here' }),
    ).toThrow(InvalidConnectorConfigurationError);
    expect(() =>
      policy.validateConnectorConfiguration('REST_API', {
        endpoint: 'http://169.254.169.254/latest/meta-data',
      }),
    ).toThrow(InvalidConnectorConfigurationError);
    expect(() =>
      policy.validateConnectorConfiguration('GITHUB', { repository: 'invalid' }),
    ).toThrow(InvalidConnectorConfigurationError);
  });

  it('limits API key scopes and expiration', () => {
    const now = new Date('2026-07-31T12:00:00.000Z');
    expect(
      policy.validateApiKey(
        ['connector.ingest', 'connector.ingest'],
        new Date('2026-08-31T12:00:00.000Z'),
        now,
      ),
    ).toEqual(['connector.ingest']);
    expect(() => policy.validateApiKey(['admin'], null, now)).toThrow(InvalidApiKeyPolicyError);
    expect(() =>
      policy.validateApiKey(['connector.ingest'], new Date('2028-01-01T00:00:00.000Z'), now),
    ).toThrow(InvalidApiKeyPolicyError);
  });
});
