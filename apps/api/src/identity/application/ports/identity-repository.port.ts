export const IDENTITY_REPOSITORY_PORT = Symbol('IDENTITY_REPOSITORY_PORT');

export interface RequestAudit {
  correlationId: string;
  ipHash?: string;
}

export interface RegisteredIdentity {
  displayName: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  userId: string;
}

export type RegistrationResult =
  { conflict: 'email' | 'organization_slug' } | { identity: RegisteredIdentity };

export interface LoginIdentity {
  displayName: string;
  email: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  membershipActive: boolean;
  mfa: {
    authTag: string;
    ciphertext: string;
    iv: string;
  } | null;
  organizationId: string;
  passwordHash: string;
  permissions: readonly string[];
  userActive: boolean;
  userId: string;
}

export interface MfaChallengeRecord {
  attempts: number;
  expiresAt: Date;
  id: string;
  mfa: {
    authTag: string;
    ciphertext: string;
    iv: string;
  };
  organizationId: string;
  userId: string;
}

export interface SessionPrincipalRecord {
  displayName: string;
  email: string;
  mfaVerified: boolean;
  organizationId: string;
  permissions: readonly string[];
  sessionId: string;
  userId: string;
}

export interface SessionRecord {
  createdAt: Date;
  current: boolean;
  deviceName: string;
  expiresAt: Date;
  id: string;
  ipAddress: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  audit: RequestAudit;
  deviceName: string;
  expiresAt: Date;
  ipAddress: string;
  mfaVerifiedAt: Date | null;
  organizationId: string;
  refreshExpiresAt: Date;
  refreshTokenFamilyId: string;
  refreshTokenHash: string;
  userAgentHash: string;
  userId: string;
}

export interface CreatedSession {
  principal: SessionPrincipalRecord;
  sessionId: string;
}

export type RefreshRotationResult =
  | { kind: 'device_mismatch' | 'invalid' | 'reused' }
  | {
      kind: 'rotated';
      principal: SessionPrincipalRecord;
    };

export interface OrganizationSummary {
  id: string;
  name: string;
  roles: readonly string[];
  slug: string;
}

export interface RoleSummary {
  description: string;
  id: string;
  isSystem: boolean;
  key: string;
  name: string;
  permissions: readonly string[];
}

export interface MemberSummary {
  displayName: string;
  email: string;
  id: string;
  roles: readonly string[];
  status: string;
  userId: string;
}

export interface InvitationResult {
  expiresAt: Date;
  id: string;
}

export interface IdentityRepositoryPort {
  acceptInvitation(input: {
    audit: RequestAudit;
    organizationId: string;
    tokenHash: string;
    userId: string;
  }): Promise<boolean>;
  activateMfa(input: {
    audit: RequestAudit;
    organizationId: string;
    recoveryCodeHashes: readonly string[];
    totpCounter: bigint;
    userId: string;
  }): Promise<boolean>;
  consumeMfaChallenge(input: {
    audit: RequestAudit;
    challengeId: string;
    organizationId: string;
    recoveryCodeHash?: string;
    totpCounter?: bigint;
    userId: string;
  }): Promise<boolean>;
  createInvitation(input: {
    audit: RequestAudit;
    email: string;
    expiresAt: Date;
    invitedByUserId: string;
    normalizedEmail: string;
    organizationId: string;
    roleId: string;
    tokenHash: string;
  }): Promise<InvitationResult | null>;
  createMfaChallenge(input: {
    expiresAt: Date;
    organizationId: string;
    userId: string;
  }): Promise<{ id: string; expiresAt: Date }>;
  createOrganization(input: {
    audit: RequestAudit;
    name: string;
    organizationId: string;
    ownerUserId: string;
    slug: string;
  }): Promise<OrganizationSummary | null>;
  createRole(input: {
    audit: RequestAudit;
    description: string;
    key: string;
    name: string;
    organizationId: string;
    permissionKeys: readonly string[];
    userId: string;
  }): Promise<RoleSummary | null>;
  createSession(input: CreateSessionInput): Promise<CreatedSession>;
  findLoginIdentity(normalizedEmail: string, organizationId: string): Promise<LoginIdentity | null>;
  getActiveSessionPrincipal(input: {
    organizationId: string;
    sessionId: string;
    userId: string;
  }): Promise<SessionPrincipalRecord | null>;
  getMfaChallenge(input: {
    challengeId: string;
    organizationId: string;
  }): Promise<MfaChallengeRecord | null>;
  getPendingMfa(userId: string): Promise<{
    authTag: string;
    ciphertext: string;
    iv: string;
  } | null>;
  listMembers(organizationId: string, userId: string): Promise<readonly MemberSummary[]>;
  listOrganizations(userId: string): Promise<readonly OrganizationSummary[]>;
  listPermissions(): Promise<readonly { description: string; key: string }[]>;
  listRoles(organizationId: string, userId: string): Promise<readonly RoleSummary[]>;
  listSessions(input: {
    currentSessionId: string;
    organizationId: string;
    userId: string;
  }): Promise<readonly SessionRecord[]>;
  recordFailedLogin(userId: string, now: Date): Promise<void>;
  register(input: {
    audit: RequestAudit;
    displayName: string;
    email: string;
    normalizedEmail: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    passwordHash: string;
    userId: string;
  }): Promise<RegistrationResult>;
  replaceMembershipRoles(input: {
    actorUserId: string;
    audit: RequestAudit;
    membershipId: string;
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<boolean>;
  resetFailedLogins(userId: string): Promise<void>;
  revokeAllSessions(input: {
    audit: RequestAudit;
    organizationId: string;
    reason: string;
    userId: string;
  }): Promise<number>;
  revokeSession(input: {
    actorUserId: string;
    audit: RequestAudit;
    organizationId: string;
    reason: string;
    sessionId: string;
  }): Promise<boolean>;
  rotateRefreshToken(input: {
    audit: RequestAudit;
    currentTokenHash: string;
    expectedUserAgentHash: string;
    newExpiresAt: Date;
    newTokenHash: string;
    now: Date;
    organizationId: string;
  }): Promise<RefreshRotationResult>;
  saveMfaEnrollment(input: {
    audit: RequestAudit;
    authTag: string;
    ciphertext: string;
    iv: string;
    label: string;
    organizationId: string;
    userId: string;
  }): Promise<boolean>;
}
