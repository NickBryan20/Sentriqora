import { SYSTEM_ROLE_PERMISSIONS } from '@aegisflow/domain';
import { Inject, Injectable } from '@nestjs/common';

import {
  InvitationStatus,
  MembershipStatus,
  MfaMethodType,
  type Prisma,
  UserStatus,
} from '../../../generated/prisma/client';
import type {
  CreateSessionInput,
  CreatedSession,
  IdentityRepositoryPort,
  InvitationResult,
  LoginIdentity,
  MemberSummary,
  MfaChallengeRecord,
  OrganizationSummary,
  RefreshRotationResult,
  RegisteredIdentity,
  RegistrationResult,
  RequestAudit,
  RoleSummary,
  SessionPrincipalRecord,
  SessionRecord,
} from '../../application/ports/identity-repository.port';
import { TenantPrismaExecutor } from './tenant-prisma.executor';

interface MembershipPermissionGraph {
  membershipRoles: {
    role: {
      rolePermissions: { permission: { key: string } }[];
    };
  }[];
}

const SYSTEM_ROLE_DETAILS: Readonly<Record<string, { description: string; name: string }>> = {
  owner: { description: 'Full control of the organization.', name: 'Owner' },
  admin: { description: 'Administration without ownership transfer.', name: 'Administrator' },
  analyst: { description: 'Security operations and investigation access.', name: 'Analyst' },
  viewer: { description: 'Read-only organizational access.', name: 'Viewer' },
};

@Injectable()
export class PrismaIdentityRepository implements IdentityRepositoryPort {
  constructor(@Inject(TenantPrismaExecutor) private readonly executor: TenantPrismaExecutor) {}

  async register(input: {
    audit: RequestAudit;
    displayName: string;
    email: string;
    normalizedEmail: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    passwordHash: string;
    userId: string;
  }): Promise<RegistrationResult> {
    try {
      return await this.executor.run(
        { organizationId: input.organizationId, userId: input.userId },
        async (transaction) => {
          const existingUser = await transaction.user.findUnique({
            select: { id: true },
            where: { normalizedEmail: input.normalizedEmail },
          });
          if (existingUser !== null) {
            return { conflict: 'email' as const };
          }

          await transaction.organization.create({
            data: {
              id: input.organizationId,
              name: input.organizationName,
              slug: input.organizationSlug,
            },
          });
          await transaction.user.create({
            data: {
              displayName: input.displayName,
              email: input.email,
              id: input.userId,
              normalizedEmail: input.normalizedEmail,
            },
          });
          await transaction.credential.create({
            data: { passwordHash: input.passwordHash, userId: input.userId },
          });
          const ownerRoleId = await this.createSystemRoles(transaction, input.organizationId);
          const membership = await transaction.membership.create({
            data: { organizationId: input.organizationId, userId: input.userId },
          });
          await transaction.membershipRole.create({
            data: {
              membershipId: membership.id,
              organizationId: input.organizationId,
              roleId: ownerRoleId,
            },
          });
          await this.recordEvent(transaction, {
            action: 'identity.registered',
            actorUserId: input.userId,
            audit: input.audit,
            organizationId: input.organizationId,
            outcome: 'success',
            targetId: input.userId,
            targetType: 'user',
          });

          const identity: RegisteredIdentity = {
            displayName: input.displayName,
            email: input.email,
            organizationId: input.organizationId,
            organizationName: input.organizationName,
            organizationSlug: input.organizationSlug,
            userId: input.userId,
          };
          return { identity };
        },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { conflict: 'organization_slug' };
      }
      throw error;
    }
  }

  findLoginIdentity(
    normalizedEmail: string,
    organizationId: string,
  ): Promise<LoginIdentity | null> {
    return this.executor.run({ organizationId, userId: null }, async (transaction) => {
      const user = await transaction.user.findUnique({
        include: {
          credential: true,
          memberships: {
            include: {
              membershipRoles: {
                include: {
                  role: {
                    include: { rolePermissions: { include: { permission: true } } },
                  },
                },
              },
            },
            where: { organizationId },
          },
          mfaMethods: { where: { type: MfaMethodType.TOTP, verifiedAt: { not: null } } },
        },
        where: { normalizedEmail },
      });
      const membership = user?.memberships[0];
      if (user === null || user.credential === null || membership === undefined) {
        return null;
      }
      const mfa = user.mfaMethods[0];
      return {
        displayName: user.displayName,
        email: user.email,
        failedAttempts: user.credential.failedAttempts,
        lockedUntil: user.credential.lockedUntil,
        membershipActive: membership.status === MembershipStatus.ACTIVE,
        mfa:
          mfa === undefined
            ? null
            : {
                authTag: mfa.encryptionAuthTag,
                ciphertext: mfa.encryptedSecret,
                iv: mfa.encryptionIv,
              },
        organizationId,
        passwordHash: user.credential.passwordHash,
        permissions: permissionKeys(membership),
        userActive: user.status === UserStatus.ACTIVE,
        userId: user.id,
      };
    });
  }

  recordFailedLogin(userId: string, now: Date): Promise<void> {
    return this.executor.run({ organizationId: null, userId }, async (transaction) => {
      await transaction.$executeRaw`
        UPDATE credentials
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE
              WHEN failed_attempts + 1 >= 5 THEN ${new Date(now.getTime() + 15 * 60_000)}
              ELSE locked_until
            END,
            updated_at = ${now}
        WHERE user_id = ${userId}::uuid
      `;
    });
  }

  resetFailedLogins(userId: string): Promise<void> {
    return this.executor.run({ organizationId: null, userId }, async (transaction) => {
      await transaction.credential.updateMany({
        data: { failedAttempts: 0, lockedUntil: null },
        where: { userId },
      });
    });
  }

  createMfaChallenge(input: {
    expiresAt: Date;
    organizationId: string;
    userId: string;
  }): Promise<{ expiresAt: Date; id: string }> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) =>
        transaction.mfaChallenge.create({
          data: input,
          select: { expiresAt: true, id: true },
        }),
    );
  }

  getMfaChallenge(input: {
    challengeId: string;
    organizationId: string;
  }): Promise<MfaChallengeRecord | null> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: null },
      async (transaction) => {
        const challenge = await transaction.mfaChallenge.findFirst({
          include: {
            user: {
              include: {
                mfaMethods: { where: { type: MfaMethodType.TOTP, verifiedAt: { not: null } } },
              },
            },
          },
          where: { consumedAt: null, id: input.challengeId, organizationId: input.organizationId },
        });
        const method = challenge?.user.mfaMethods[0];
        if (challenge === null || method === undefined) {
          return null;
        }
        return {
          attempts: challenge.attempts,
          expiresAt: challenge.expiresAt,
          id: challenge.id,
          mfa: {
            authTag: method.encryptionAuthTag,
            ciphertext: method.encryptedSecret,
            iv: method.encryptionIv,
          },
          organizationId: challenge.organizationId,
          userId: challenge.userId,
        };
      },
    );
  }

  consumeMfaChallenge(input: {
    audit: RequestAudit;
    challengeId: string;
    organizationId: string;
    recoveryCodeHash?: string;
    totpCounter?: bigint;
    userId: string;
  }): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const challenge = await transaction.mfaChallenge.findFirst({
          where: {
            attempts: { lt: 5 },
            consumedAt: null,
            expiresAt: { gt: new Date() },
            id: input.challengeId,
            userId: input.userId,
          },
        });
        if (challenge === null) {
          return false;
        }

        let factorConsumed = false;
        if (input.totpCounter !== undefined) {
          const updated = await transaction.mfaMethod.updateMany({
            data: { lastUsedCounter: input.totpCounter },
            where: {
              OR: [{ lastUsedCounter: null }, { lastUsedCounter: { lt: input.totpCounter } }],
              type: MfaMethodType.TOTP,
              userId: input.userId,
              verifiedAt: { not: null },
            },
          });
          factorConsumed = updated.count === 1;
        } else if (input.recoveryCodeHash !== undefined) {
          const updated = await transaction.recoveryCode.updateMany({
            data: { usedAt: new Date() },
            where: { codeHash: input.recoveryCodeHash, usedAt: null, userId: input.userId },
          });
          factorConsumed = updated.count === 1;
        }

        if (!factorConsumed) {
          await transaction.mfaChallenge.updateMany({
            data: { attempts: { increment: 1 } },
            where: { attempts: challenge.attempts, consumedAt: null, id: challenge.id },
          });
          return false;
        }

        const consumed = await transaction.mfaChallenge.updateMany({
          data: { consumedAt: new Date() },
          where: { attempts: challenge.attempts, consumedAt: null, id: challenge.id },
        });
        if (consumed.count !== 1) {
          return false;
        }
        await this.recordEvent(transaction, {
          action: 'auth.mfa_challenge.completed',
          actorUserId: input.userId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: challenge.id,
          targetType: 'mfa_challenge',
        });
        return true;
      },
    );
  }

  saveMfaEnrollment(input: {
    audit: RequestAudit;
    authTag: string;
    ciphertext: string;
    iv: string;
    label: string;
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const existing = await transaction.mfaMethod.findUnique({
          where: { userId_type: { type: MfaMethodType.TOTP, userId: input.userId } },
        });
        if (existing?.verifiedAt !== null && existing !== null) {
          return false;
        }
        await transaction.mfaMethod.upsert({
          create: {
            encryptedSecret: input.ciphertext,
            encryptionAuthTag: input.authTag,
            encryptionIv: input.iv,
            label: input.label,
            userId: input.userId,
          },
          update: {
            encryptedSecret: input.ciphertext,
            encryptionAuthTag: input.authTag,
            encryptionIv: input.iv,
            label: input.label,
            lastUsedCounter: null,
          },
          where: { userId_type: { type: MfaMethodType.TOTP, userId: input.userId } },
        });
        await this.recordEvent(transaction, {
          action: 'auth.mfa_enrollment.started',
          actorUserId: input.userId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: input.userId,
          targetType: 'user',
        });
        return true;
      },
    );
  }

  getPendingMfa(
    userId: string,
  ): Promise<{ authTag: string; ciphertext: string; iv: string } | null> {
    return this.executor.run({ organizationId: null, userId }, async (transaction) => {
      const method = await transaction.mfaMethod.findUnique({
        where: { userId_type: { type: MfaMethodType.TOTP, userId } },
      });
      if (method === null || method.verifiedAt !== null) {
        return null;
      }
      return {
        authTag: method.encryptionAuthTag,
        ciphertext: method.encryptedSecret,
        iv: method.encryptionIv,
      };
    });
  }

  activateMfa(input: {
    audit: RequestAudit;
    organizationId: string;
    recoveryCodeHashes: readonly string[];
    totpCounter: bigint;
    userId: string;
  }): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const activated = await transaction.mfaMethod.updateMany({
          data: { lastUsedCounter: input.totpCounter, verifiedAt: new Date() },
          where: { type: MfaMethodType.TOTP, userId: input.userId, verifiedAt: null },
        });
        if (activated.count !== 1) {
          return false;
        }
        await transaction.recoveryCode.createMany({
          data: input.recoveryCodeHashes.map((codeHash) => ({ codeHash, userId: input.userId })),
        });
        await this.recordEvent(transaction, {
          action: 'auth.mfa_enrollment.activated',
          actorUserId: input.userId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: input.userId,
          targetType: 'user',
        });
        return true;
      },
    );
  }

  createSession(input: CreateSessionInput): Promise<CreatedSession> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const session = await transaction.session.create({
          data: {
            deviceName: input.deviceName,
            expiresAt: input.expiresAt,
            ipAddress: input.ipAddress,
            mfaVerifiedAt: input.mfaVerifiedAt,
            organizationId: input.organizationId,
            userAgentHash: input.userAgentHash,
            userId: input.userId,
          },
        });
        await transaction.refreshToken.create({
          data: {
            expiresAt: input.refreshExpiresAt,
            familyId: input.refreshTokenFamilyId,
            organizationId: input.organizationId,
            sessionId: session.id,
            tokenHash: input.refreshTokenHash,
          },
        });
        const principal = await this.principalFor(
          transaction,
          input.organizationId,
          input.userId,
          session.id,
          isRecentMfa(input.mfaVerifiedAt, new Date()),
        );
        if (principal === null) {
          throw new Error('The session principal could not be created');
        }
        await this.recordEvent(transaction, {
          action: 'auth.session.created',
          actorUserId: input.userId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: session.id,
          targetType: 'session',
        });
        return { principal, sessionId: session.id };
      },
    );
  }

  getActiveSessionPrincipal(input: {
    organizationId: string;
    sessionId: string;
    userId: string;
  }): Promise<SessionPrincipalRecord | null> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const session = await transaction.session.findFirst({
          where: {
            expiresAt: { gt: new Date() },
            id: input.sessionId,
            organizationId: input.organizationId,
            revokedAt: null,
            userId: input.userId,
          },
        });
        if (session === null) {
          return null;
        }
        return this.principalFor(
          transaction,
          input.organizationId,
          input.userId,
          session.id,
          isRecentMfa(session.mfaVerifiedAt, new Date()),
        );
      },
    );
  }

  rotateRefreshToken(input: {
    audit: RequestAudit;
    currentTokenHash: string;
    expectedUserAgentHash: string;
    newExpiresAt: Date;
    newTokenHash: string;
    now: Date;
    organizationId: string;
  }): Promise<RefreshRotationResult> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: null },
      async (transaction) => {
        const current = await transaction.refreshToken.findUnique({
          include: { session: true },
          where: { tokenHash: input.currentTokenHash },
        });
        if (current === null || current.organizationId !== input.organizationId) {
          return { kind: 'invalid' };
        }
        if (current.session.userAgentHash !== input.expectedUserAgentHash) {
          await this.revokeSessionGraph(
            transaction,
            current.sessionId,
            'device_mismatch',
            input.now,
          );
          return { kind: 'device_mismatch' };
        }
        if (current.usedAt !== null || current.revokedAt !== null) {
          await this.revokeSessionGraph(transaction, current.sessionId, 'refresh_reuse', input.now);
          await this.recordEvent(transaction, {
            action: 'auth.refresh.reuse_detected',
            actorUserId: current.session.userId,
            audit: input.audit,
            organizationId: input.organizationId,
            outcome: 'blocked',
            targetId: current.sessionId,
            targetType: 'session',
          });
          return { kind: 'reused' };
        }
        if (
          current.expiresAt <= input.now ||
          current.session.expiresAt <= input.now ||
          current.session.revokedAt !== null
        ) {
          return { kind: 'invalid' };
        }
        const consumed = await transaction.refreshToken.updateMany({
          data: { usedAt: input.now },
          where: { id: current.id, revokedAt: null, usedAt: null },
        });
        if (consumed.count !== 1) {
          await this.revokeSessionGraph(transaction, current.sessionId, 'refresh_reuse', input.now);
          return { kind: 'reused' };
        }
        await transaction.refreshToken.create({
          data: {
            expiresAt: input.newExpiresAt,
            familyId: current.familyId,
            organizationId: current.organizationId,
            parentTokenId: current.id,
            sessionId: current.sessionId,
            tokenHash: input.newTokenHash,
          },
        });
        await transaction.session.update({
          data: { lastSeenAt: input.now },
          where: { id: current.sessionId },
        });
        const principal = await this.principalFor(
          transaction,
          current.organizationId,
          current.session.userId,
          current.sessionId,
          isRecentMfa(current.session.mfaVerifiedAt, input.now),
        );
        return principal === null ? { kind: 'invalid' } : { kind: 'rotated', principal };
      },
    );
  }

  listSessions(input: {
    currentSessionId: string;
    organizationId: string;
    userId: string;
  }): Promise<readonly SessionRecord[]> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const sessions = await transaction.session.findMany({
          orderBy: { createdAt: 'desc' },
          where: { organizationId: input.organizationId, userId: input.userId },
        });
        return sessions.map((session) => ({
          createdAt: session.createdAt,
          current: session.id === input.currentSessionId,
          deviceName: session.deviceName,
          expiresAt: session.expiresAt,
          id: session.id,
          ipAddress: session.ipAddress,
          lastSeenAt: session.lastSeenAt,
          revokedAt: session.revokedAt,
        }));
      },
    );
  }

  revokeSession(input: {
    actorUserId: string;
    audit: RequestAudit;
    organizationId: string;
    reason: string;
    sessionId: string;
  }): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.actorUserId },
      async (transaction) => {
        const session = await transaction.session.findFirst({
          where: {
            id: input.sessionId,
            organizationId: input.organizationId,
            userId: input.actorUserId,
          },
        });
        if (session === null) {
          return false;
        }
        await this.revokeSessionGraph(transaction, session.id, input.reason, new Date());
        await this.recordEvent(transaction, {
          action: 'auth.session.revoked',
          actorUserId: input.actorUserId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: session.id,
          targetType: 'session',
        });
        return true;
      },
    );
  }

  revokeAllSessions(input: {
    audit: RequestAudit;
    organizationId: string;
    reason: string;
    userId: string;
  }): Promise<number> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const now = new Date();
        const sessions = await transaction.session.findMany({
          select: { id: true },
          where: { organizationId: input.organizationId, revokedAt: null, userId: input.userId },
        });
        await transaction.session.updateMany({
          data: { revokeReason: input.reason, revokedAt: now },
          where: { id: { in: sessions.map((session) => session.id) } },
        });
        await transaction.refreshToken.updateMany({
          data: { revokedAt: now },
          where: { sessionId: { in: sessions.map((session) => session.id) }, revokedAt: null },
        });
        await this.recordEvent(transaction, {
          action: 'auth.sessions.revoked_all',
          actorUserId: input.userId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: input.userId,
          targetType: 'user',
        });
        return sessions.length;
      },
    );
  }

  listOrganizations(userId: string): Promise<readonly OrganizationSummary[]> {
    return this.executor.run({ organizationId: null, userId }, async (transaction) => {
      const memberships = await transaction.membership.findMany({
        include: {
          membershipRoles: { include: { role: true } },
          organization: true,
        },
        orderBy: { organization: { name: 'asc' } },
        where: { status: MembershipStatus.ACTIVE, userId },
      });
      return memberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        roles: membership.membershipRoles.map((membershipRole) => membershipRole.role.key),
        slug: membership.organization.slug,
      }));
    });
  }

  createOrganization(input: {
    audit: RequestAudit;
    name: string;
    organizationId: string;
    ownerUserId: string;
    slug: string;
  }): Promise<OrganizationSummary | null> {
    return this.executor
      .run(
        { organizationId: input.organizationId, userId: input.ownerUserId },
        async (transaction) => {
          await transaction.organization.create({
            data: { id: input.organizationId, name: input.name, slug: input.slug },
          });
          const ownerRoleId = await this.createSystemRoles(transaction, input.organizationId);
          const membership = await transaction.membership.create({
            data: { organizationId: input.organizationId, userId: input.ownerUserId },
          });
          await transaction.membershipRole.create({
            data: {
              membershipId: membership.id,
              organizationId: input.organizationId,
              roleId: ownerRoleId,
            },
          });
          await this.recordEvent(transaction, {
            action: 'organization.created',
            actorUserId: input.ownerUserId,
            audit: input.audit,
            organizationId: input.organizationId,
            outcome: 'success',
            targetId: input.organizationId,
            targetType: 'organization',
          });
          return { id: input.organizationId, name: input.name, roles: ['owner'], slug: input.slug };
        },
      )
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          return null;
        }
        throw error;
      });
  }

  createInvitation(input: {
    audit: RequestAudit;
    email: string;
    expiresAt: Date;
    invitedByUserId: string;
    normalizedEmail: string;
    organizationId: string;
    roleId: string;
    tokenHash: string;
  }): Promise<InvitationResult | null> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.invitedByUserId },
      async (transaction) => {
        const [role, existingMember] = await Promise.all([
          transaction.role.findFirst({
            where: { id: input.roleId, organizationId: input.organizationId },
          }),
          transaction.membership.findFirst({
            where: {
              organizationId: input.organizationId,
              user: { normalizedEmail: input.normalizedEmail },
            },
          }),
        ]);
        if (role === null || existingMember !== null) {
          return null;
        }
        const invitation = await transaction.invitation.create({
          data: {
            email: input.email,
            expiresAt: input.expiresAt,
            invitedByUserId: input.invitedByUserId,
            normalizedEmail: input.normalizedEmail,
            organizationId: input.organizationId,
            roleId: input.roleId,
            tokenHash: input.tokenHash,
          },
          select: { expiresAt: true, id: true },
        });
        await this.recordEvent(transaction, {
          action: 'organization.member.invited',
          actorUserId: input.invitedByUserId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: invitation.id,
          targetType: 'invitation',
        });
        return invitation;
      },
    );
  }

  acceptInvitation(input: {
    audit: RequestAudit;
    organizationId: string;
    tokenHash: string;
    userId: string;
  }): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.userId },
      async (transaction) => {
        const [invitation, user] = await Promise.all([
          transaction.invitation.findFirst({
            where: {
              expiresAt: { gt: new Date() },
              organizationId: input.organizationId,
              status: InvitationStatus.PENDING,
              tokenHash: input.tokenHash,
            },
          }),
          transaction.user.findUnique({ where: { id: input.userId } }),
        ]);
        if (
          invitation === null ||
          user === null ||
          invitation.normalizedEmail !== user.normalizedEmail
        ) {
          return false;
        }
        const existing = await transaction.membership.findUnique({
          where: {
            organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
          },
        });
        if (existing !== null) {
          return false;
        }
        const accepted = await transaction.invitation.updateMany({
          data: {
            acceptedAt: new Date(),
            acceptedByUserId: input.userId,
            status: InvitationStatus.ACCEPTED,
          },
          where: { id: invitation.id, status: InvitationStatus.PENDING },
        });
        if (accepted.count !== 1) {
          return false;
        }
        const membership = await transaction.membership.create({
          data: { organizationId: input.organizationId, userId: input.userId },
        });
        await transaction.membershipRole.create({
          data: {
            membershipId: membership.id,
            organizationId: input.organizationId,
            roleId: invitation.roleId,
          },
        });
        await this.recordEvent(transaction, {
          action: 'organization.invitation.accepted',
          actorUserId: input.userId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: invitation.id,
          targetType: 'invitation',
        });
        return true;
      },
    );
  }

  listMembers(organizationId: string, userId: string): Promise<readonly MemberSummary[]> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const memberships = await transaction.membership.findMany({
        include: { membershipRoles: { include: { role: true } }, user: true },
        orderBy: { createdAt: 'asc' },
        where: { organizationId },
      });
      return memberships.map((membership) => ({
        displayName: membership.user.displayName,
        email: membership.user.email,
        id: membership.id,
        roles: membership.membershipRoles.map((membershipRole) => membershipRole.role.key),
        status: membership.status,
        userId: membership.userId,
      }));
    });
  }

  listRoles(organizationId: string, userId: string): Promise<readonly RoleSummary[]> {
    return this.executor.run({ organizationId, userId }, async (transaction) => {
      const roles = await transaction.role.findMany({
        include: { rolePermissions: { include: { permission: true } } },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        where: { organizationId },
      });
      return roles.map(roleSummary);
    });
  }

  listPermissions(): Promise<readonly { description: string; key: string }[]> {
    return this.executor.run({ organizationId: null, userId: null }, (transaction) =>
      transaction.permission.findMany({
        orderBy: { key: 'asc' },
        select: { description: true, key: true },
      }),
    );
  }

  createRole(input: {
    audit: RequestAudit;
    description: string;
    key: string;
    name: string;
    organizationId: string;
    permissionKeys: readonly string[];
    userId: string;
  }): Promise<RoleSummary | null> {
    return this.executor
      .run({ organizationId: input.organizationId, userId: input.userId }, async (transaction) => {
        const uniquePermissions = [...new Set(input.permissionKeys)];
        const permissions = await transaction.permission.findMany({
          where: { key: { in: uniquePermissions } },
        });
        if (permissions.length !== uniquePermissions.length) {
          return null;
        }
        const role = await transaction.role.create({
          data: {
            description: input.description,
            key: input.key,
            name: input.name,
            organizationId: input.organizationId,
          },
        });
        await transaction.rolePermission.createMany({
          data: permissions.map((permission) => ({
            organizationId: input.organizationId,
            permissionId: permission.id,
            roleId: role.id,
          })),
        });
        await this.recordEvent(transaction, {
          action: 'organization.role.created',
          actorUserId: input.userId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: role.id,
          targetType: 'role',
        });
        return {
          description: role.description,
          id: role.id,
          isSystem: role.isSystem,
          key: role.key,
          name: role.name,
          permissions: uniquePermissions,
        };
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) {
          return null;
        }
        throw error;
      });
  }

  replaceMembershipRoles(input: {
    actorUserId: string;
    audit: RequestAudit;
    membershipId: string;
    organizationId: string;
    roleIds: readonly string[];
  }): Promise<boolean> {
    return this.executor.run(
      { organizationId: input.organizationId, userId: input.actorUserId },
      async (transaction) => {
        const [membership, roles] = await Promise.all([
          transaction.membership.findFirst({
            include: { membershipRoles: { include: { role: true } } },
            where: { id: input.membershipId, organizationId: input.organizationId },
          }),
          transaction.role.findMany({
            where: {
              id: { in: [...new Set(input.roleIds)] },
              organizationId: input.organizationId,
            },
          }),
        ]);
        if (membership === null || roles.length !== new Set(input.roleIds).size) {
          return false;
        }
        const removingOwnOwnership =
          membership.userId === input.actorUserId &&
          membership.membershipRoles.some(
            (membershipRole) => membershipRole.role.key === 'owner',
          ) &&
          !roles.some((role) => role.key === 'owner');
        if (removingOwnOwnership) {
          return false;
        }
        await transaction.membershipRole.deleteMany({
          where: { membershipId: input.membershipId, organizationId: input.organizationId },
        });
        await transaction.membershipRole.createMany({
          data: roles.map((role) => ({
            membershipId: input.membershipId,
            organizationId: input.organizationId,
            roleId: role.id,
          })),
        });
        await this.recordEvent(transaction, {
          action: 'organization.membership.roles_replaced',
          actorUserId: input.actorUserId,
          audit: input.audit,
          organizationId: input.organizationId,
          outcome: 'success',
          targetId: input.membershipId,
          targetType: 'membership',
        });
        return true;
      },
    );
  }

  private async createSystemRoles(
    transaction: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<string> {
    const permissions = await transaction.permission.findMany();
    const permissionIds = new Map(permissions.map((permission) => [permission.key, permission.id]));
    let ownerRoleId = '';
    for (const [key, grantedPermissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
      const detail = SYSTEM_ROLE_DETAILS[key];
      if (detail === undefined) {
        throw new Error(`Missing system role details for ${key}`);
      }
      const role = await transaction.role.create({
        data: {
          description: detail.description,
          isSystem: true,
          key,
          name: detail.name,
          organizationId,
        },
      });
      await transaction.rolePermission.createMany({
        data: grantedPermissions.map((permissionKey) => {
          const permissionId = permissionIds.get(permissionKey);
          if (permissionId === undefined) {
            throw new Error(`Permission catalog is missing ${permissionKey}`);
          }
          return { organizationId, permissionId, roleId: role.id };
        }),
      });
      if (key === 'owner') {
        ownerRoleId = role.id;
      }
    }
    if (ownerRoleId.length === 0) {
      throw new Error('The owner role was not created');
    }
    return ownerRoleId;
  }

  private async principalFor(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    sessionId: string,
    mfaVerified: boolean,
  ): Promise<SessionPrincipalRecord | null> {
    const membership = await transaction.membership.findUnique({
      include: {
        membershipRoles: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        },
        user: true,
      },
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (
      membership === null ||
      membership.status !== MembershipStatus.ACTIVE ||
      membership.user.status !== UserStatus.ACTIVE
    ) {
      return null;
    }
    return {
      displayName: membership.user.displayName,
      email: membership.user.email,
      mfaVerified,
      organizationId,
      permissions: permissionKeys(membership),
      sessionId,
      userId,
    };
  }

  private async revokeSessionGraph(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await transaction.session.updateMany({
      data: { revokeReason: reason, revokedAt: now },
      where: { id: sessionId, revokedAt: null },
    });
    await transaction.refreshToken.updateMany({
      data: { revokedAt: now },
      where: { revokedAt: null, sessionId },
    });
  }

  private recordEvent(
    transaction: Prisma.TransactionClient,
    input: {
      action: string;
      actorUserId: string;
      audit: RequestAudit;
      organizationId: string;
      outcome: string;
      targetId: string;
      targetType: string;
    },
  ): Promise<unknown> {
    return transaction.eventRecord.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        correlationId: input.audit.correlationId,
        ...(input.audit.ipHash === undefined ? {} : { ipHash: input.audit.ipHash }),
        organizationId: input.organizationId,
        outcome: input.outcome,
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
  }
}

function permissionKeys(membership: MembershipPermissionGraph): readonly string[] {
  return [
    ...new Set(
      membership.membershipRoles.flatMap((membershipRole) =>
        membershipRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.key),
      ),
    ),
  ].sort();
}

function roleSummary(role: {
  description: string;
  id: string;
  isSystem: boolean;
  key: string;
  name: string;
  rolePermissions: { permission: { key: string } }[];
}): RoleSummary {
  return {
    description: role.description,
    id: role.id,
    isSystem: role.isSystem,
    key: role.key,
    name: role.name,
    permissions: role.rolePermissions.map((rolePermission) => rolePermission.permission.key).sort(),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function isRecentMfa(verifiedAt: Date | null, now: Date): boolean {
  return verifiedAt !== null && now.getTime() - verifiedAt.getTime() <= 15 * 60_000;
}
