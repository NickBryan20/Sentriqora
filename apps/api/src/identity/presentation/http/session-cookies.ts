import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';

import type { Environment } from '../../../configuration';
import type { AuthenticatedSessionResult } from '../../application/identity.use-cases';

export const ACCESS_COOKIE = 'aegisflow_access';
export const REFRESH_COOKIE = 'aegisflow_refresh';
export const CSRF_COOKIE = 'aegisflow_csrf';
export const ORGANIZATION_COOKIE = 'aegisflow_organization';

@Injectable()
export class SessionCookieWriter {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>) {}

  write(response: Response, session: AuthenticatedSessionResult): void {
    const common = this.commonOptions();
    response.cookie(ACCESS_COOKIE, session.accessToken, {
      ...common,
      httpOnly: true,
      maxAge: this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }) * 1_000,
      path: '/',
    });
    response.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...common,
      httpOnly: true,
      maxAge: this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }) * 1_000,
      path: '/api/v1/auth/refresh',
    });
    response.cookie(ORGANIZATION_COOKIE, session.principal.organizationId, {
      ...common,
      httpOnly: true,
      maxAge: this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }) * 1_000,
      path: '/api/v1/auth/refresh',
    });
    response.cookie(CSRF_COOKIE, session.csrfToken, {
      ...common,
      httpOnly: false,
      maxAge: this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }) * 1_000,
      path: '/',
    });
  }

  clear(response: Response): void {
    const common = this.commonOptions();
    response.clearCookie(ACCESS_COOKIE, { ...common, httpOnly: true, path: '/' });
    response.clearCookie(REFRESH_COOKIE, {
      ...common,
      httpOnly: true,
      path: '/api/v1/auth/refresh',
    });
    response.clearCookie(ORGANIZATION_COOKIE, {
      ...common,
      httpOnly: true,
      path: '/api/v1/auth/refresh',
    });
    response.clearCookie(CSRF_COOKIE, { ...common, httpOnly: false, path: '/' });
  }

  private commonOptions(): Pick<CookieOptions, 'sameSite' | 'secure'> {
    return {
      sameSite: 'strict',
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
    };
  }
}
