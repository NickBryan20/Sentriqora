import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { validateEnvironment } from './configuration';
import { DetectionModule } from './detection/detection.module';
import { EventModule } from './events/event.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { IncidentModule } from './incidents/incident.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MetricsModule } from './metrics/metrics.module';
import { ResourceModule } from './resources/resource.module';

const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      forRoutes: [{ method: RequestMethod.ALL, path: '{*path}' }],
      pinoHttp: {
        genReqId: (request, response) => {
          const candidate = request.headers['x-correlation-id'];
          const id =
            typeof candidate === 'string' && CORRELATION_ID_PATTERN.test(candidate)
              ? candidate
              : randomUUID();
          request.headers['x-correlation-id'] = id;
          response.setHeader('x-correlation-id', id);
          return id;
        },
        level: process.env.LOG_LEVEL ?? 'info',
        redact: {
          censor: '[REDACTED]',
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-api-key',
            'req.headers.x-csrf-token',
            'res.headers.set-cookie',
          ],
        },
      },
    }),
    HealthModule,
    DetectionModule,
    EventModule,
    IdentityModule,
    IncidentModule,
    KnowledgeModule,
    MetricsModule,
    ResourceModule,
  ],
})
export class AppModule {}
