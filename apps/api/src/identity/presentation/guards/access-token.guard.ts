import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { ApplicationError } from '../../application/application-error';
import { IdentityUseCases } from '../../application/identity.use-cases';
import { ACCESS_COOKIE } from '../http/session-cookies';
import { readCookie } from '../http/request-context';
import type { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(@Inject(IdentityUseCases) private readonly useCases: IdentityUseCases) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    const bearer =
      authorization?.startsWith('Bearer ') === true ? authorization.slice(7).trim() : null;
    const token =
      bearer === null || bearer.length === 0 ? readCookie(request, ACCESS_COOKIE) : bearer;
    if (token === null) {
      throw new ApplicationError('invalid_token', 'Authentication is required.', 401);
    }
    request.principal = await this.useCases.authenticateAccessToken(token);
    return true;
  }
}
