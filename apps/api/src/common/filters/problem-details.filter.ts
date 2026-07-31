import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdentityDomainError } from '@aegisflow/domain';
import { ZodError } from 'zod';

import { ApplicationError } from '../../identity/application/application-error';

interface ProblemDetails {
  code?: string;
  correlationId: string;
  detail: string;
  instance: string;
  status: number;
  title: string;
  type: string;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = this.statusFor(exception);
    const correlationId = response.getHeader('x-correlation-id')?.toString() ?? 'unavailable';

    if (!(exception instanceof HttpException)) {
      const errorName = exception instanceof Error ? exception.name : 'UnknownError';
      const errorCode =
        typeof exception === 'object' &&
        exception !== null &&
        'code' in exception &&
        typeof exception.code === 'string'
          ? exception.code
          : undefined;
      const errorMeta =
        typeof exception === 'object' && exception !== null && 'meta' in exception
          ? exception.meta
          : undefined;
      const databaseErrorCode =
        typeof errorMeta === 'object' &&
        errorMeta !== null &&
        'code' in errorMeta &&
        typeof errorMeta.code === 'string'
          ? errorMeta.code
          : undefined;
      this.logger.error(
        {
          correlationId,
          ...(databaseErrorCode === undefined ? {} : { databaseErrorCode }),
          ...(errorCode === undefined ? {} : { errorCode }),
          ...(process.env.NODE_ENV === 'test' && errorMeta !== undefined ? { errorMeta } : {}),
          errorName,
        },
        'Unhandled request error',
      );
    }

    const code = this.codeFor(exception);
    const problem: ProblemDetails = {
      ...(code === null ? {} : { code }),
      correlationId,
      detail:
        status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? 'The service could not complete the request.'
          : this.publicDetail(exception),
      instance: request.originalUrl,
      status,
      title: this.titleFor(status),
      type: `https://httpstatuses.io/${status}`,
    };

    response.status(status).type('application/problem+json').json(problem);
  }

  private codeFor(exception: unknown): string | null {
    if (exception instanceof ApplicationError || exception instanceof IdentityDomainError) {
      return exception.code;
    }
    if (exception instanceof ZodError) {
      return 'validation_failed';
    }
    return null;
  }

  private statusFor(exception: unknown): number {
    if (exception instanceof ApplicationError) {
      return exception.status;
    }
    if (exception instanceof IdentityDomainError || exception instanceof ZodError) {
      return HttpStatus.BAD_REQUEST;
    }
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private publicDetail(exception: unknown): string {
    if (exception instanceof ApplicationError || exception instanceof IdentityDomainError) {
      return exception.message;
    }
    if (exception instanceof ZodError) {
      return 'The request payload is invalid.';
    }
    if (!(exception instanceof HttpException)) {
      return 'The request could not be completed.';
    }

    const body: unknown = exception.getResponse();
    if (typeof body === 'string') {
      return body;
    }

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
        return message.join('; ');
      }
    }

    return 'The request was rejected.';
  }

  private titleFor(status: number): string {
    const title = HttpStatus[status];
    return typeof title === 'string' ? title.replaceAll('_', ' ') : 'Request error';
  }
}
