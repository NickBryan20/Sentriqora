import { Module } from '@nestjs/common';

import {
  DEPENDENCY_HEALTH_PORT,
  type DependencyHealthPort,
} from './application/ports/dependency-health.port';
import { CheckReadinessUseCase } from './application/use-cases/check-readiness.use-case';
import { TcpDependencyHealthAdapter } from './infrastructure/tcp-dependency-health.adapter';
import { HealthController } from './presentation/health.controller';

@Module({
  controllers: [HealthController],
  providers: [
    TcpDependencyHealthAdapter,
    {
      provide: DEPENDENCY_HEALTH_PORT,
      useExisting: TcpDependencyHealthAdapter,
    },
    {
      provide: CheckReadinessUseCase,
      inject: [DEPENDENCY_HEALTH_PORT],
      useFactory: (port: DependencyHealthPort) => new CheckReadinessUseCase(port),
    },
  ],
})
export class HealthModule {}
