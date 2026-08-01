import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { IncidentUseCases } from './application/incident.use-cases';
import { EVIDENCE_STORAGE_PORT } from './application/ports/evidence-storage.port';
import { INCIDENT_REPOSITORY_PORT } from './application/ports/incident-repository.port';
import { MinioEvidenceStorageAdapter } from './infrastructure/minio-evidence-storage.adapter';
import { PrismaIncidentRepository } from './infrastructure/prisma-incident.repository';
import { IncidentController } from './presentation/incident.controller';

@Module({
  controllers: [IncidentController],
  imports: [IdentityModule],
  providers: [
    IncidentUseCases,
    PrismaIncidentRepository,
    MinioEvidenceStorageAdapter,
    { provide: INCIDENT_REPOSITORY_PORT, useExisting: PrismaIncidentRepository },
    { provide: EVIDENCE_STORAGE_PORT, useExisting: MinioEvidenceStorageAdapter },
  ],
})
export class IncidentModule {}
