import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ApplicationError } from '../../identity/application/application-error';
import { ResourceUseCases } from '../application/resource.use-cases';

@ApiTags('Connector Ingress')
@Controller('ingress/organizations/:organizationId/connectors/:connectorId')
export class ConnectorIngressController {
  constructor(@Inject(ResourceUseCases) private readonly useCases: ResourceUseCases) {}

  @Post()
  @HttpCode(202)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-API-Key', required: false })
  @ApiHeader({ name: 'X-Webhook-Signature', required: false })
  @ApiHeader({ name: 'X-Webhook-Timestamp', required: false })
  @ApiOperation({
    summary: 'Authenticate and persist an idempotent connector receipt for Phase 3 processing',
  })
  async receive(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-api-key') apiKey: string | undefined,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-timestamp') timestamp: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.rawBody === undefined) {
      throw new ApplicationError('validation_failed', 'The raw request body is required.', 400);
    }
    const result = await this.useCases.receiveIngress({
      apiKey,
      connectorId,
      correlationId: request.header('x-correlation-id') ?? 'unavailable',
      contentType: contentType ?? 'application/octet-stream',
      idempotencyKey,
      ipAddress: request.ip || request.socket.remoteAddress || '0.0.0.0',
      organizationId,
      rawBody: request.rawBody,
      signature,
      timestamp,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    return result.value;
  }
}
