import type { HealthResponse } from '@aegisflow/contracts';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CheckReadinessUseCase } from '../application/use-cases/check-readiness.use-case';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(CheckReadinessUseCase) private readonly checkReadiness: CheckReadinessUseCase,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  @ApiOkResponse({ description: 'The API process is accepting requests.' })
  live(): HealthResponse {
    return {
      service: 'aegisflow-api',
      status: 'up',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness probe' })
  @ApiOkResponse({ description: 'All required dependencies are reachable.' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is unavailable.' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const health = await this.checkReadiness.execute();
    if (health.status !== 'up') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return health;
  }
}
