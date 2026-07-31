import type { ComponentHealth } from '@aegisflow/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DEPENDENCY_HEALTH_PORT } from '../src/health/application/ports/dependency-health.port';

describe('health endpoints', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const components: ComponentHealth[] = [
      { name: 'postgresql', status: 'up' },
      { name: 'redis', status: 'up' },
      { name: 'minio', status: 'up' },
    ];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DEPENDENCY_HEALTH_PORT)
      .useValue({ check: async () => components })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes liveness with a correlation id', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

    expect(response.headers['x-correlation-id']).toBeTypeOf('string');
    expect(response.body).toMatchObject({ service: 'aegisflow-api', status: 'up' });
  });

  it('reports readiness', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    expect(response.body.components).toHaveLength(3);
  });
});
