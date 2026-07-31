import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { validateEnvironment } from './configuration';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (request, response) => {
          const candidate = request.headers['x-correlation-id'];
          const id = typeof candidate === 'string' ? candidate : randomUUID();
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
            'res.headers.set-cookie',
          ],
        },
      },
    }),
    HealthModule,
    MetricsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*path}');
  }
}
