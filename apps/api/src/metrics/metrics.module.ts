import { Module } from '@nestjs/common';
import { collectDefaultMetrics } from 'prom-client';

import { MetricsController } from './metrics.controller';

collectDefaultMetrics({ prefix: 'aegisflow_api_' });

@Module({
  controllers: [MetricsController],
})
export class MetricsModule {}
