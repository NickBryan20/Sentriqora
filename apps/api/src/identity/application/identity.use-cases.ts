import type {
  AcceptInvitationInput,
  AuthPrincipal,
  CreateInvitationInput,
  CreateOrganizationInput,
  CreateRoleInput,
  LoginInput,
  RegisterIdentityInput,
  ReplaceMembershipRolesInput,
  VerifyMfaLoginInput,
} from '@aegisflow/contracts';
import { EmailAddress, OrganizationSlug, PasswordPolicy } from '@aegisflow/domain';
import { Inject, Injectable } from '@nestjs/common';

import { ApplicationError } from './application-error';
import { CLOCK_PORT, type ClockPort } from './ports/clock.port';
import { IDENTITY_POLICY, type IdentityPolicy } from './ports/identity-policy';
import {
  IDENTITY_REPOSITORY_PORT,
  type IdentityRepositoryPort,
  type MemberSummary,
  type OrganizationSummary,
  type RequestAudit,
  type RoleSummary,
  type SessionRecord,
} from './ports/identity-repository.port';
import { IDENTITY_SECURITY_PORT, type IdentitySecurityPort } from './ports/identity-security.port';
import { LOGIN_PROTECTION_PORT, type LoginProtectionPort } from './ports/login-protection.port';

export interface RequestContext {
  correlationId: string;
  ipAddress: string;
  userAgent: string;
}

export interface AuthenticatedSessionResult {
  accessToken: string;
  csrfToken: string;
  principal: AuthPrincipal;
  refreshToken: string;
}

export type LoginResult =
  AuthenticatedSessionResult | { challengeId: string; expiresAt: Date; mfaRequired: true };

@Injectable()
export class IdentityUseCases {
  private readonly passwordPolicy = new PasswordPolicy();

  constructor(
    @Inject(IDENTITY_REPOSITORY_PORT)
    private readonly repository: IdentityRepositoryPort,
    @Inject(IDENTITY_SECURITY_PORT)
    private readonly security: IdentitySecurityPort,
    @Inject(LOGIN_PROTECTION_PORT)
    private readonly loginProtection: LoginProtectionPort,
    @Inject(CLOCK_PORT)
    private readonly clock: ClockPort,
    @Inject(IDENTITY_POLICY)
    private readonly policy: IdentityPolicy,
  ) {}

  async register(input: RegisterIdentityInput, context: RequestContext) {
    const email = EmailAddress.create(input.email);
    const displayName = input.displayName.trim();
    const organizationName = input.organizationName.trim();
    const slug = OrganizationSlug.create(input.organizationSlug ?? organizationName);
    const emailLocalPart = email.normalized.split('@')[0] ?? '';
    const password = this.passwordPolicy.validate(input.password, [emailLocalPart, displayName]);
    const passwordHash = await this.security.hashPassword(password);
    const userId = this.security.generateId();
    const organizationId = this.security.generateId();
    const result = await this.repository.register({
      audit: this.audit(context),
      displayName,
      email: email.value,
      normalizedEmail: email.normalized,
      organizationId,
      organizationName,
      organizationSlug: slug.value,
      passwordHash,
      userId,
    });

    if ('conflict' in result) {
      throw new ApplicationError('conflict', 'The identity could not be registered.', 409);
    }

    return result.identity;
  }

  async login(input: LoginInput, context: RequestContext): Promise<LoginResult> {
    const email = EmailAddress.create(input.email);
    await this.loginProtection.assertAllowed(context.ipAddress, email.normalized);
    const now = this.clock.now();
    const identity = await this.repository.findLoginIdentity(
      email.normalized,
      input.organizationId,
    );

    if (identity === null) {
      await this.security.hashPassword(input.password);
      await this.loginProtection.recordFailure(context.ipAddress, email.normalized);
      throw this.authenticationFailed();
    }

    const passwordMatches = await this.security.verifyPassword(
      identity.passwordHash,
      input.password,
    );
    const locked = identity.lockedUntil !== null && identity.lockedUntil > now;
    if (!passwordMatches || locked || !identity.userActive || !identity.membershipActive) {
      await Promise.all([
        this.loginProtection.recordFailure(context.ipAddress, email.normalized),
        this.repository.recordFailedLogin(identity.userId, now),
      ]);
      throw this.authenticationFailed();
    }

    await Promise.all([
      this.loginProtection.resetIdentity(email.normalized),
      this.repository.resetFailedLogins(identity.userId),
    ]);

    if (identity.mfa !== null) {
      const expiresAt = this.plusSeconds(now, this.policy.mfaChallengeTtlSeconds);
      const challenge = await this.repository.createMfaChallenge({
        expiresAt,
        organizationId: identity.organizationId,
        userId: identity.userId,
      });
      return { challengeId: challenge.id, expiresAt: challenge.expiresAt, mfaRequired: true };
    }

    return this.createAuthenticatedSession(
      {
        mfaVerifiedAt: null,
        organizationId: identity.organizationId,
        userId: identity.userId,
      },
      input.deviceName,
      context,
    );
  }

  async completeMfaLogin(
    input: VerifyMfaLoginInput,
    context: RequestContext,
  ): Promise<AuthenticatedSessionResult> {
    const challenge = await this.repository.getMfaChallenge({
      challengeId: input.challengeId,
      organizationId: input.organizationId,
    });
    const now = this.clock.now();
    if (challenge === null || challenge.expiresAt <= now || challenge.attempts >= 5) {
      throw new ApplicationError(
        'invalid_mfa_code',
        'The MFA challenge is invalid or expired.',
        401,
      );
    }

    const normalizedCode = input.code.replaceAll('-', '').trim().toLocaleUpperCase('en-US');
    let totpCounter: bigint | undefined;
    let recoveryCodeHash: string | undefined;

    if (/^\d{6}$/u.test(normalizedCode)) {
      const secret = this.security.decrypt(challenge.mfa);
      totpCounter = this.security.verifyTotp(secret, normalizedCode, now) ?? undefined;
    } else {
      recoveryCodeHash = this.security.hashOpaqueToken(normalizedCode);
    }

    const consumed = await this.repository.consumeMfaChallenge({
      audit: this.audit(context),
      challengeId: challenge.id,
      organizationId: challenge.organizationId,
      ...(recoveryCodeHash === undefined ? {} : { recoveryCodeHash }),
      ...(totpCounter === undefined ? {} : { totpCounter }),
      userId: challenge.userId,
    });
    if (!consumed) {
      throw new ApplicationError(
        'invalid_mfa_code',
        'The MFA challenge is invalid or expired.',
        401,
      );
    }

    return this.createAuthenticatedSession(
      {
        mfaVerifiedAt: now,
        organizationId: challenge.organizationId,
        userId: challenge.userId,
      },
      input.deviceName,
      context,
    );
  }

  async authenticateAccessToken(token: string): Promise<AuthPrincipal> {
    let claims: AuthPrincipal;
    try {
      claims = this.security.verifyAccessToken(token);
    } catch {
      throw new ApplicationError('invalid_token', 'Authentication is required.', 401);
    }

    const active = await this.repository.getActiveSessionPrincipal({
      organizationId: claims.organizationId,
      sessionId: claims.sessionId,
      userId: claims.userId,
    });
    if (active === null) {
      throw new ApplicationError('invalid_token', 'Authentication is required.', 401);
    }

    return {
      mfaVerified: active.mfaVerified,
      organizationId: active.organizationId,
      permissions: [...active.permissions],
      sessionId: active.sessionId,
      userId: active.userId,
    };
  }

  async refresh(
    refreshToken: string,
    organizationId: string,
    context: RequestContext,
  ): Promise<AuthenticatedSessionResult> {
    const nextToken = this.security.generateOpaqueToken();
    const now = this.clock.now();
    const rotated = await this.repository.rotateRefreshToken({
      audit: this.audit(context),
      currentTokenHash: this.security.hashOpaqueToken(refreshToken),
      expectedUserAgentHash: this.security.hashFingerprint(context.userAgent),
      newExpiresAt: this.plusSeconds(now, this.policy.refreshTokenTtlSeconds),
      newTokenHash: nextToken.hash,
      now,
      organizationId,
    });

    if (rotated.kind === 'reused') {
      throw new ApplicationError('session_reused', 'The session was revoked.', 401);
    }
    if (rotated.kind !== 'rotated') {
      throw new ApplicationError('invalid_token', 'The refresh token is invalid.', 401);
    }

    const principal: AuthPrincipal = {
      mfaVerified: rotated.principal.mfaVerified,
      organizationId: rotated.principal.organizationId,
      permissions: [...rotated.principal.permissions],
      sessionId: rotated.principal.sessionId,
      userId: rotated.principal.userId,
    };
    return {
      accessToken: this.security.issueAccessToken(principal),
      csrfToken: this.security.generateOpaqueToken().plainText,
      principal,
      refreshToken: nextToken.plainText,
    };
  }

  async beginMfaEnrollment(
    principal: AuthPrincipal,
    context: RequestContext,
  ): Promise<{
    otpauthUri: string;
    secret: string;
  }> {
    const secret = this.security.generateTotpSecret();
    const encrypted = this.security.encrypt(secret);
    const saved = await this.repository.saveMfaEnrollment({
      audit: this.audit(context),
      authTag: encrypted.authTag,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      label: 'AegisFlow TOTP',
      organizationId: principal.organizationId,
      userId: principal.userId,
    });
    if (!saved) {
      throw new ApplicationError('conflict', 'MFA is already active for this identity.', 409);
    }

    const account = encodeURIComponent(`user-${principal.userId}`);
    const issuer = encodeURIComponent('AegisFlow');
    return {
      otpauthUri: `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      secret,
    };
  }

  async confirmMfaEnrollment(
    principal: AuthPrincipal,
    code: string,
    context: RequestContext,
  ): Promise<{ recoveryCodes: readonly string[] }> {
    const pending = await this.repository.getPendingMfa(principal.userId);
    if (pending === null) {
      throw new ApplicationError('not_found', 'No pending MFA enrollment exists.', 404);
    }
    const counter = this.security.verifyTotp(
      this.security.decrypt(pending),
      code,
      this.clock.now(),
    );
    if (counter === null) {
      throw new ApplicationError('invalid_mfa_code', 'The MFA code is invalid.', 400);
    }
    const codes = this.security.generateRecoveryCodes(10);
    const activated = await this.repository.activateMfa({
      audit: this.audit(context),
      organizationId: principal.organizationId,
      recoveryCodeHashes: codes.hashes,
      totpCounter: counter,
      userId: principal.userId,
    });
    if (!activated) {
      throw new ApplicationError('conflict', 'MFA could not be activated.', 409);
    }
    return { recoveryCodes: codes.plainTextCodes };
  }

  async listSessions(principal: AuthPrincipal): Promise<readonly SessionRecord[]> {
    return this.repository.listSessions({
      currentSessionId: principal.sessionId,
      organizationId: principal.organizationId,
      userId: principal.userId,
    });
  }

  async revokeSession(
    principal: AuthPrincipal,
    sessionId: string,
    context: RequestContext,
  ): Promise<void> {
    const revoked = await this.repository.revokeSession({
      actorUserId: principal.userId,
      audit: this.audit(context),
      organizationId: principal.organizationId,
      reason: 'user_requested',
      sessionId,
    });
    if (!revoked) {
      throw new ApplicationError('not_found', 'The session was not found.', 404);
    }
  }

  async revokeAllSessions(principal: AuthPrincipal, context: RequestContext): Promise<number> {
    return this.repository.revokeAllSessions({
      audit: this.audit(context),
      organizationId: principal.organizationId,
      reason: 'global_logout',
      userId: principal.userId,
    });
  }

  async listOrganizations(principal: AuthPrincipal): Promise<readonly OrganizationSummary[]> {
    return this.repository.listOrganizations(principal.userId);
  }

  async createOrganization(
    principal: AuthPrincipal,
    input: CreateOrganizationInput,
    context: RequestContext,
  ): Promise<OrganizationSummary> {
    const name = input.name.trim();
    const organization = await this.repository.createOrganization({
      audit: this.audit(context),
      name,
      organizationId: this.security.generateId(),
      ownerUserId: principal.userId,
      slug: OrganizationSlug.create(input.slug ?? name).value,
    });
    if (organization === null) {
      throw new ApplicationError('conflict', 'The organization could not be created.', 409);
    }
    return organization;
  }

  async createInvitation(
    principal: AuthPrincipal,
    organizationId: string,
    input: CreateInvitationInput,
    context: RequestContext,
  ): Promise<{ expiresAt: Date; id: string; token: string }> {
    const email = EmailAddress.create(input.email);
    const token = this.security.generateOpaqueToken();
    const invitation = await this.repository.createInvitation({
      audit: this.audit(context),
      email: email.value,
      expiresAt: this.plusSeconds(this.clock.now(), this.policy.invitationTtlSeconds),
      invitedByUserId: principal.userId,
      normalizedEmail: email.normalized,
      organizationId,
      roleId: input.roleId,
      tokenHash: token.hash,
    });
    if (invitation === null) {
      throw new ApplicationError('validation_failed', 'The invitation could not be created.', 400);
    }
    return { ...invitation, token: token.plainText };
  }

  async acceptInvitation(
    principal: AuthPrincipal,
    input: AcceptInvitationInput,
    context: RequestContext,
  ): Promise<void> {
    const accepted = await this.repository.acceptInvitation({
      audit: this.audit(context),
      organizationId: input.organizationId,
      tokenHash: this.security.hashOpaqueToken(input.token),
      userId: principal.userId,
    });
    if (!accepted) {
      throw new ApplicationError('invalid_token', 'The invitation is invalid or expired.', 400);
    }
  }

  async listMembers(
    principal: AuthPrincipal,
    organizationId: string,
  ): Promise<readonly MemberSummary[]> {
    return this.repository.listMembers(organizationId, principal.userId);
  }

  async listRoles(
    principal: AuthPrincipal,
    organizationId: string,
  ): Promise<readonly RoleSummary[]> {
    return this.repository.listRoles(organizationId, principal.userId);
  }

  async listPermissions() {
    return this.repository.listPermissions();
  }

  async createRole(
    principal: AuthPrincipal,
    organizationId: string,
    input: CreateRoleInput,
    context: RequestContext,
  ): Promise<RoleSummary> {
    const role = await this.repository.createRole({
      audit: this.audit(context),
      description: input.description.trim(),
      key: input.key,
      name: input.name.trim(),
      organizationId,
      permissionKeys: input.permissions,
      userId: principal.userId,
    });
    if (role === null) {
      throw new ApplicationError('validation_failed', 'The role could not be created.', 400);
    }
    return role;
  }

  async replaceMembershipRoles(
    principal: AuthPrincipal,
    organizationId: string,
    membershipId: string,
    input: ReplaceMembershipRolesInput,
    context: RequestContext,
  ): Promise<void> {
    const replaced = await this.repository.replaceMembershipRoles({
      actorUserId: principal.userId,
      audit: this.audit(context),
      membershipId,
      organizationId,
      roleIds: input.roleIds,
    });
    if (!replaced) {
      throw new ApplicationError(
        'validation_failed',
        'The role assignment could not be changed.',
        400,
      );
    }
  }

  private async createAuthenticatedSession(
    identity: { mfaVerifiedAt: Date | null; organizationId: string; userId: string },
    deviceName: string,
    context: RequestContext,
  ): Promise<AuthenticatedSessionResult> {
    const now = this.clock.now();
    const refresh = this.security.generateOpaqueToken();
    const created = await this.repository.createSession({
      audit: this.audit(context),
      deviceName: deviceName.trim(),
      expiresAt: this.plusSeconds(now, this.policy.refreshTokenTtlSeconds),
      ipAddress: context.ipAddress,
      mfaVerifiedAt: identity.mfaVerifiedAt,
      organizationId: identity.organizationId,
      refreshExpiresAt: this.plusSeconds(now, this.policy.refreshTokenTtlSeconds),
      refreshTokenFamilyId: this.security.generateId(),
      refreshTokenHash: refresh.hash,
      userAgentHash: this.security.hashFingerprint(context.userAgent),
      userId: identity.userId,
    });
    const principal: AuthPrincipal = {
      mfaVerified: created.principal.mfaVerified,
      organizationId: created.principal.organizationId,
      permissions: [...created.principal.permissions],
      sessionId: created.sessionId,
      userId: created.principal.userId,
    };
    return {
      accessToken: this.security.issueAccessToken(principal),
      csrfToken: this.security.generateOpaqueToken().plainText,
      principal,
      refreshToken: refresh.plainText,
    };
  }

  private audit(context: RequestContext): RequestAudit {
    return {
      correlationId: context.correlationId,
      ipHash: this.security.hashFingerprint(context.ipAddress),
    };
  }

  private authenticationFailed(): ApplicationError {
    return new ApplicationError('authentication_failed', 'Authentication failed.', 401);
  }

  private plusSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1_000);
  }
}
