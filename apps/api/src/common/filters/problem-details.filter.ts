import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ProblemDetails {
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
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const correlationId = response.getHeader('x-correlation-id')?.toString() ?? 'unavailable';

    if (!(exception instanceof HttpException)) {
      const errorName = exception instanceof Error ? exception.name : 'UnknownError';
      this.logger.error({ correlationId, errorName }, 'Unhandled request error');
    }

    const problem: ProblemDetails = {
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

  private publicDetail(exception: unknown): string {
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
