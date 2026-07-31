import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const candidate = request.header('x-correlation-id');
    const correlationId =
      candidate !== undefined && CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();

    request.headers['x-correlation-id'] = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  }
}
