import type { AuthPrincipal } from '@aegisflow/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ApplicationError } from '../../application/application-error';
import { IdentityUseCases } from '../../application/identity.use-cases';
import { AccessTokenGuard } from '../guards/access-token.guard';
import { Principal, PermissionsGuard, RequirePermissions } from '../guards/authorization.guards';
import { CsrfGuard } from '../guards/csrf.guard';
import {
  ConfirmMfaEnrollmentDto,
  LoginDto,
  RegisterIdentityDto,
  VerifyMfaLoginDto,
} from './identity.dto';
import { readCookie, requestContext } from './request-context';
import { ORGANIZATION_COOKIE, REFRESH_COOKIE, SessionCookieWriter } from './session-cookies';

@ApiTags('Identity & Access')
@ApiExtraModels(ConfirmMfaEnrollmentDto, LoginDto, RegisterIdentityDto, VerifyMfaLoginDto)
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(IdentityUseCases) private readonly useCases: IdentityUseCases,
    @Inject(SessionCookieWriter) private readonly cookies: SessionCookieWriter,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a user and its first organization' })
  @ApiResponse({
    status: 201,
    description: 'Identity registered. The organization ID is needed at login.',
  })
  register(@Body() input: RegisterIdentityDto, @Req() request: Request) {
    return this.useCases.register(input, requestContext(request));
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate with a password and request MFA when configured' })
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.login(input, requestContext(request));
    if ('mfaRequired' in result) {
      return result;
    }
    this.cookies.write(response, result);
    return { mfaRequired: false, principal: result.principal };
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete an MFA challenge with TOTP or one recovery code' })
  async verifyMfa(
    @Body() input: VerifyMfaLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.completeMfaLogin(input, requestContext(request));
    this.cookies.write(response, result);
    return { mfaRequired: false, principal: result.principal };
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  @ApiCookieAuth('session-cookie')
  @ApiOperation({ summary: 'Return the active session principal' })
  me(@Principal() principal: AuthPrincipal): AuthPrincipal {
    return principal;
  }

  @Post('mfa/enrollment')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions('mfa.manage')
  @ApiCookieAuth('session-cookie')
  @ApiOperation({ summary: 'Create a pending TOTP enrollment and reveal its secret once' })
  beginMfaEnrollment(@Principal() principal: AuthPrincipal, @Req() request: Request) {
    return this.useCases.beginMfaEnrollment(principal, requestContext(request));
  }

  @Post('mfa/enrollment/confirm')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions('mfa.manage')
  @ApiCookieAuth('session-cookie')
  @ApiOperation({ summary: 'Activate TOTP and reveal recovery codes once' })
  confirmMfaEnrollment(
    @Principal() principal: AuthPrincipal,
    @Body() input: ConfirmMfaEnrollmentDto,
    @Req() request: Request,
  ) {
    return this.useCases.confirmMfaEnrollment(principal, input.code, requestContext(request));
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new short-lived access token' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    const organizationId = readCookie(request, ORGANIZATION_COOKIE);
    if (refreshToken === null || organizationId === null) {
      throw new ApplicationError('invalid_token', 'The refresh token is invalid.', 401);
    }
    const result = await this.useCases.refresh(
      refreshToken,
      organizationId,
      requestContext(request),
    );
    this.cookies.write(response, result);
    return { principal: result.principal };
  }

  @Get('sessions')
  @UseGuards(AccessTokenGuard, PermissionsGuard)
  @RequirePermissions('session.read')
  @ApiCookieAuth('session-cookie')
  @ApiOperation({ summary: 'List sessions owned by the current user in the active organization' })
  listSessions(@Principal() principal: AuthPrincipal) {
    return this.useCases.listSessions(principal);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(AccessTokenGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions('session.revoke')
  @ApiCookieAuth('session-cookie')
  @ApiOperation({ summary: 'Revoke one session owned by the current user' })
  async revokeSession(
    @Principal() principal: AuthPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revoked: true }> {
    await this.useCases.revokeSession(principal, sessionId, requestContext(request));
    if (sessionId === principal.sessionId) {
      this.cookies.clear(response);
    }
    return { revoked: true };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions('session.revoke')
  @ApiCookieAuth('session-cookie')
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Principal() principal: AuthPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revoked: true }> {
    await this.useCases.revokeSession(principal, principal.sessionId, requestContext(request));
    this.cookies.clear(response);
    return { revoked: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard, CsrfGuard, PermissionsGuard)
  @RequirePermissions('session.revoke')
  @ApiCookieAuth('session-cookie')
  @ApiOperation({ summary: 'Revoke all sessions in the active organization' })
  async logoutAll(
    @Principal() principal: AuthPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revokedSessions: number }> {
    const revokedSessions = await this.useCases.revokeAllSessions(
      principal,
      requestContext(request),
    );
    this.cookies.clear(response);
    return { revokedSessions };
  }
}
