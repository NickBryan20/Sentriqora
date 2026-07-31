import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

import { ApplicationError } from '../../application/application-error';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../http/session-cookies';
import { readCookie } from '../http/request-context';
import type { AuthenticatedRequest } from './authenticated-request';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (
      SAFE_METHODS.has(request.method) ||
      (readCookie(request, ACCESS_COOKIE) === null && readCookie(request, REFRESH_COOKIE) === null)
    ) {
      return true;
    }
    const cookieToken = readCookie(request, CSRF_COOKIE);
    const headerToken = request.header('x-csrf-token') ?? null;
    if (cookieToken === null || headerToken === null || !safeEqual(cookieToken, headerToken)) {
      throw new ApplicationError('csrf_failed', 'The CSRF token is invalid.', 403);
    }
    return true;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return (
    leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer)
  );
}
