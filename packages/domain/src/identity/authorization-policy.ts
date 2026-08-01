export const PERMISSION_KEYS = [
  'organization.read',
  'organization.manage',
  'member.read',
  'member.invite',
  'member.manage',
  'role.read',
  'role.manage',
  'session.read',
  'session.revoke',
  'mfa.manage',
  'asset.read',
  'asset.manage',
  'connector.read',
  'connector.manage',
  'connector.secret.rotate',
  'api-key.read',
  'api-key.manage',
  'event.read',
  'detection-rule.read',
  'detection-rule.manage',
  'alert.read',
  'alert.triage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const SYSTEM_ROLE_PERMISSIONS: Readonly<Record<string, readonly PermissionKey[]>> = {
  owner: PERMISSION_KEYS,
  admin: [
    'organization.read',
    'organization.manage',
    'member.read',
    'member.invite',
    'member.manage',
    'role.read',
    'role.manage',
    'session.read',
    'session.revoke',
    'mfa.manage',
    'asset.read',
    'asset.manage',
    'connector.read',
    'connector.manage',
    'connector.secret.rotate',
    'api-key.read',
    'api-key.manage',
    'event.read',
    'detection-rule.read',
    'detection-rule.manage',
    'alert.read',
    'alert.triage',
  ],
  analyst: [
    'organization.read',
    'member.read',
    'role.read',
    'session.read',
    'session.revoke',
    'mfa.manage',
    'asset.read',
    'asset.manage',
    'connector.read',
    'event.read',
    'detection-rule.read',
    'detection-rule.manage',
    'alert.read',
    'alert.triage',
  ],
  viewer: [
    'organization.read',
    'member.read',
    'role.read',
    'session.read',
    'session.revoke',
    'mfa.manage',
    'asset.read',
    'connector.read',
    'event.read',
    'detection-rule.read',
    'alert.read',
  ],
};

export interface AuthorizationPrincipal {
  organizationId: string;
  permissions: readonly string[];
  userId: string;
}

export class AuthorizationPolicy {
  canAccessOrganization(principal: AuthorizationPrincipal, organizationId: string): boolean {
    return principal.organizationId === organizationId;
  }

  hasEveryPermission(
    principal: AuthorizationPrincipal,
    requiredPermissions: readonly PermissionKey[],
  ): boolean {
    const granted = new Set(principal.permissions);
    return requiredPermissions.every((permission) => granted.has(permission));
  }
}
