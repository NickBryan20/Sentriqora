import type { AuthPrincipal } from '@aegisflow/contracts';
import { AuthorizationPolicy, type PermissionKey } from '@aegisflow/domain';
import { createParamDecorator, Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApplicationError } from '../../application/application-error';
import type { AuthenticatedRequest } from './authenticated-request';

const REQUIRED_PERMISSIONS = 'aegisflow.required-permissions';

export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const Principal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw new ApplicationError('invalid_token', 'Authentication is required.', 401);
    }
    return request.principal;
  },
);

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly policy = new AuthorizationPolicy();

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly PermissionKey[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (principal === undefined || !this.policy.hasEveryPermission(principal, required)) {
      throw new ApplicationError('forbidden', 'The operation is not permitted.', 403);
    }
    return true;
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly policy = new AuthorizationPolicy();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.params['organizationId'];
    if (typeof organizationId !== 'string') {
      return true;
    }
    const principal = request.principal;
    if (principal === undefined || !this.policy.canAccessOrganization(principal, organizationId)) {
      throw new ApplicationError('forbidden', 'The operation is not permitted.', 403);
    }
    return true;
  }
}

@Injectable()
export class MfaVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal?.mfaVerified !== true) {
      throw new ApplicationError('forbidden', 'MFA reauthentication is required.', 403);
    }
    return true;
  }
}
