import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Environment } from '../configuration';
import { IdentityUseCases } from './application/identity.use-cases';
import { CLOCK_PORT } from './application/ports/clock.port';
import { IDENTITY_POLICY, type IdentityPolicy } from './application/ports/identity-policy';
import { IDENTITY_REPOSITORY_PORT } from './application/ports/identity-repository.port';
import { IDENTITY_SECURITY_PORT } from './application/ports/identity-security.port';
import { LOGIN_PROTECTION_PORT } from './application/ports/login-protection.port';
import { NodeIdentitySecurityAdapter } from './infrastructure/node-identity-security.adapter';
import { PrismaIdentityRepository } from './infrastructure/prisma/prisma-identity.repository';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { TenantPrismaExecutor } from './infrastructure/prisma/tenant-prisma.executor';
import { RedisLoginProtectionAdapter } from './infrastructure/redis-login-protection.adapter';
import { SystemClockAdapter } from './infrastructure/system-clock.adapter';
import { AccessTokenGuard } from './presentation/guards/access-token.guard';
import {
  MfaVerifiedGuard,
  PermissionsGuard,
  TenantGuard,
} from './presentation/guards/authorization.guards';
import { CsrfGuard } from './presentation/guards/csrf.guard';
import { AuthController } from './presentation/http/auth.controller';
import { OrganizationsController } from './presentation/http/organizations.controller';
import { SessionCookieWriter } from './presentation/http/session-cookies';

@Module({
  controllers: [AuthController, OrganizationsController],
  providers: [
    IdentityUseCases,
    PrismaService,
    TenantPrismaExecutor,
    PrismaIdentityRepository,
    NodeIdentitySecurityAdapter,
    RedisLoginProtectionAdapter,
    SystemClockAdapter,
    SessionCookieWriter,
    AccessTokenGuard,
    CsrfGuard,
    PermissionsGuard,
    TenantGuard,
    MfaVerifiedGuard,
    { provide: IDENTITY_REPOSITORY_PORT, useExisting: PrismaIdentityRepository },
    { provide: IDENTITY_SECURITY_PORT, useExisting: NodeIdentitySecurityAdapter },
    { provide: LOGIN_PROTECTION_PORT, useExisting: RedisLoginProtectionAdapter },
    { provide: CLOCK_PORT, useExisting: SystemClockAdapter },
    {
      provide: IDENTITY_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): IdentityPolicy => ({
        invitationTtlSeconds: 7 * 24 * 60 * 60,
        mfaChallengeTtlSeconds: 5 * 60,
        refreshTokenTtlSeconds: config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }),
      }),
    },
  ],
  exports: [
    IdentityUseCases,
    PrismaService,
    TenantPrismaExecutor,
    IDENTITY_SECURITY_PORT,
    AccessTokenGuard,
    CsrfGuard,
    PermissionsGuard,
    TenantGuard,
    MfaVerifiedGuard,
  ],
})
export class IdentityModule {}
