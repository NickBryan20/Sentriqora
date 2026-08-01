import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { DetectionUseCases } from './application/detection.use-cases';
import { DETECTION_REPOSITORY_PORT } from './application/ports/detection-repository.port';
import { PrismaDetectionRepository } from './infrastructure/prisma-detection.repository';
import { DetectionController } from './presentation/detection.controller';

@Module({
  controllers: [DetectionController],
  imports: [IdentityModule],
  providers: [
    DetectionUseCases,
    PrismaDetectionRepository,
    { provide: DETECTION_REPOSITORY_PORT, useExisting: PrismaDetectionRepository },
  ],
})
export class DetectionModule {}
