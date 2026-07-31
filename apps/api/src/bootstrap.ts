import { ClassSerializerInterceptor, type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import type { Environment } from './configuration';

export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApplication(app);
  return app;
}

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  const environment = config.get('NODE_ENV', { infer: true });
  const allowedOrigins = config
    .get('CORS_ALLOWED_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Correlation-Id', 'X-CSRF-Token'],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: allowedOrigins,
  });
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      hsts: environment === 'production',
      ...(environment === 'production' ? {} : { contentSecurityPolicy: false }),
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      whitelist: true,
    }),
  );

  if (environment !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AegisFlow API')
        .setDescription('API REST versionada para la plataforma AegisFlow.')
        .setVersion('0.1.0')
        .addCookieAuth(
          'aegisflow_access',
          { description: 'Short-lived HttpOnly access cookie', in: 'cookie', type: 'apiKey' },
          'session-cookie',
        )
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'AegisFlow API',
      swaggerOptions: { persistAuthorization: false },
    });
  }
}
