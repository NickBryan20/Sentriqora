import type { AuthPrincipal } from '@aegisflow/contracts';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { type Environment, validateEnvironment } from '../src/configuration';
import { NodeIdentitySecurityAdapter } from '../src/identity/infrastructure/node-identity-security.adapter';

function createAdapter(): NodeIdentitySecurityAdapter {
  const environment = validateEnvironment({
    AUTH_ENCRYPTION_KEY: 'ZGV2LW9ubHktYWVzLWtleS0zMi1ieXRlcy1sb25nISE=',
    AUTH_JWT_SECRET: 'unit-test-jwt-secret-is-at-least-thirty-two-bytes',
    AUTH_TOKEN_PEPPER: 'unit-test-token-pepper-at-least-thirty-two-bytes',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test',
  });
  return new NodeIdentitySecurityAdapter(new ConfigService<Environment, true>(environment));
}

const principal: AuthPrincipal = {
  mfaVerified: true,
  organizationId: '10000000-0000-4000-8000-000000000001',
  permissions: ['organization.read'],
  sessionId: '20000000-0000-4000-8000-000000000002',
  userId: '30000000-0000-4000-8000-000000000003',
};

describe('NodeIdentitySecurityAdapter', () => {
  it('uses Argon2id and verifies the password', async () => {
    const adapter = createAdapter();
    const passwordHash = await adapter.hashPassword('a long test password 2026');
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
    await expect(adapter.verifyPassword(passwordHash, 'a long test password 2026')).resolves.toBe(
      true,
    );
    await expect(adapter.verifyPassword(passwordHash, 'incorrect password')).resolves.toBe(false);
  });

  it('encrypts TOTP secrets with authenticated encryption', () => {
    const adapter = createAdapter();
    const encrypted = adapter.encrypt('JBSWY3DPEHPK3PXP');
    expect(adapter.decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP');
    expect(() =>
      adapter.decrypt({ ...encrypted, ciphertext: `${encrypted.ciphertext}A` }),
    ).toThrow();
  });

  it('validates the RFC TOTP vector and rejects a neighboring invalid value', () => {
    const adapter = createAdapter();
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(adapter.verifyTotp(secret, '287082', new Date(59_000))).toBe(1n);
    expect(adapter.verifyTotp(secret, '287083', new Date(59_000))).toBeNull();
  });

  it('enforces the JWT signature and fixed claims', () => {
    const adapter = createAdapter();
    const token = adapter.issueAccessToken(principal);
    expect(adapter.verifyAccessToken(token)).toEqual(principal);

    const [, payload] = token.split('.');
    const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${payload}.`;
    expect(() => adapter.verifyAccessToken(noneToken)).toThrow();
    const [header, body, signature = ''] = token.split('.');
    const tamperedSignature = `${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`;
    expect(() => adapter.verifyAccessToken(`${header}.${body}.${tamperedSignature}`)).toThrow();
  });

  it('stores only stable hashes for opaque and recovery tokens', () => {
    const adapter = createAdapter();
    const opaque = adapter.generateOpaqueToken();
    expect(opaque.hash).toBe(adapter.hashOpaqueToken(opaque.plainText));
    expect(opaque.hash).not.toContain(opaque.plainText);

    const recovery = adapter.generateRecoveryCodes(10);
    expect(new Set(recovery.plainTextCodes).size).toBe(10);
    expect(recovery.hashes).toHaveLength(10);
  });
});
