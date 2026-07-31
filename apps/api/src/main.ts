import 'reflect-metadata';
import './telemetry';

import { ConfigService } from '@nestjs/config';

import { createApplication } from './bootstrap';
import type { Environment } from './configuration';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(
    config.get('API_PORT', { infer: true }),
    config.get('API_HOST', { infer: true }),
  );
}

void bootstrap();
