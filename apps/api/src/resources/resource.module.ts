import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { ResourceUseCases } from './application/resource.use-cases';
import { INGRESS_PROTECTION_PORT } from './application/ports/ingress-protection.port';
import { RESOURCE_REPOSITORY_PORT } from './application/ports/resource-repository.port';
import { PrismaResourceRepository } from './infrastructure/prisma-resource.repository';
import { RedisIngressProtectionAdapter } from './infrastructure/redis-ingress-protection.adapter';
import { ConnectorIngressController } from './presentation/connector-ingress.controller';
import { ResourcesController } from './presentation/resources.controller';

@Module({
  controllers: [ResourcesController, ConnectorIngressController],
  imports: [IdentityModule],
  providers: [
    ResourceUseCases,
    PrismaResourceRepository,
    RedisIngressProtectionAdapter,
    { provide: RESOURCE_REPOSITORY_PORT, useExisting: PrismaResourceRepository },
    { provide: INGRESS_PROTECTION_PORT, useExisting: RedisIngressProtectionAdapter },
  ],
})
export class ResourceModule {}
