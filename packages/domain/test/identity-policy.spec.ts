import {
  AuthorizationPolicy,
  EmailAddress,
  OrganizationSlug,
  PasswordPolicy,
  WeakPasswordError,
} from '../src';
import { describe, expect, it } from 'vitest';

describe('identity domain policies', () => {
  it('normalizes email and organization slugs deterministically', () => {
    expect(EmailAddress.create('  Alicia@Example.TEST ').normalized).toBe('alicia@example.test');
    expect(OrganizationSlug.create('Equipo Respuesta Ñandú').value).toBe('equipo-respuesta-nandu');
  });

  it('accepts long passphrases without composition rules', () => {
    expect(new PasswordPolicy().validate('four calm words protect 2026')).toBe(
      'four calm words protect 2026',
    );
  });

  it('rejects common passwords and identity fragments', () => {
    const policy = new PasswordPolicy();
    expect(() => policy.validate('password123456')).toThrow(WeakPasswordError);
    expect(() => policy.validate('alicia-secure-2026', ['alicia'])).toThrow(WeakPasswordError);
  });

  it('requires both tenant equality and every requested permission', () => {
    const policy = new AuthorizationPolicy();
    const principal = {
      organizationId: 'organization-a',
      permissions: ['member.read', 'role.read'],
      userId: 'user-a',
    };
    expect(policy.canAccessOrganization(principal, 'organization-a')).toBe(true);
    expect(policy.canAccessOrganization(principal, 'organization-b')).toBe(false);
    expect(policy.hasEveryPermission(principal, ['member.read', 'role.read'])).toBe(true);
    expect(policy.hasEveryPermission(principal, ['member.manage'])).toBe(false);
  });
});
