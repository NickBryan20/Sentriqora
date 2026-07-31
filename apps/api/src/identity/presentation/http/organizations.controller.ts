import type { AuthPrincipal } from '@aegisflow/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiExtraModels, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { IdentityUseCases } from '../../application/identity.use-cases';
import { AccessTokenGuard } from '../guards/access-token.guard';
import {
  MfaVerifiedGuard,
  PermissionsGuard,
  Principal,
  RequirePermissions,
  TenantGuard,
} from '../guards/authorization.guards';
import { CsrfGuard } from '../guards/csrf.guard';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  CreateOrganizationDto,
  CreateRoleDto,
  ReplaceMembershipRolesDto,
} from './identity.dto';
import { requestContext } from './request-context';

@ApiTags('Organizations & Tenancy')
@ApiCookieAuth('session-cookie')
@ApiExtraModels(
  AcceptInvitationDto,
  CreateInvitationDto,
  CreateOrganizationDto,
  CreateRoleDto,
  ReplaceMembershipRolesDto,
)
@Controller('organizations')
@UseGuards(AccessTokenGuard, TenantGuard, PermissionsGuard)
export class OrganizationsController {
  constructor(@Inject(IdentityUseCases) private readonly useCases: IdentityUseCases) {}

  @Get()
  @RequirePermissions('organization.read')
  @ApiOperation({ summary: 'List organizations where the current user has an active membership' })
  listOrganizations(@Principal() principal: AuthPrincipal) {
    return this.useCases.listOrganizations(principal);
  }

  @Post()
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('organization.manage')
  @ApiOperation({ summary: 'Create another organization with the current user as owner' })
  createOrganization(
    @Principal() principal: AuthPrincipal,
    @Body() input: CreateOrganizationDto,
    @Req() request: Request,
  ) {
    return this.useCases.createOrganization(principal, input, requestContext(request));
  }

  @Post('invitations/accept')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Accept an invitation addressed to the authenticated user' })
  async acceptInvitation(
    @Principal() principal: AuthPrincipal,
    @Body() input: AcceptInvitationDto,
    @Req() request: Request,
  ): Promise<{ accepted: true }> {
    await this.useCases.acceptInvitation(principal, input, requestContext(request));
    return { accepted: true };
  }

  @Get(':organizationId/members')
  @RequirePermissions('member.read')
  @ApiOperation({ summary: 'List memberships without crossing the active organization boundary' })
  listMembers(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.useCases.listMembers(principal, organizationId);
  }

  @Post(':organizationId/invitations')
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('member.invite')
  @ApiOperation({ summary: 'Create a one-time organization invitation' })
  createInvitation(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateInvitationDto,
    @Req() request: Request,
  ) {
    return this.useCases.createInvitation(
      principal,
      organizationId,
      input,
      requestContext(request),
    );
  }

  @Get(':organizationId/roles')
  @RequirePermissions('role.read')
  @ApiOperation({ summary: 'List organization roles and their permissions' })
  listRoles(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.useCases.listRoles(principal, organizationId);
  }

  @Get(':organizationId/permissions')
  @RequirePermissions('role.read')
  @ApiOperation({ summary: 'List the stable permission catalog' })
  listPermissions() {
    return this.useCases.listPermissions();
  }

  @Post(':organizationId/roles')
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('role.manage')
  @ApiOperation({ summary: 'Create an organization-scoped custom role' })
  createRole(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateRoleDto,
    @Req() request: Request,
  ) {
    return this.useCases.createRole(principal, organizationId, input, requestContext(request));
  }

  @Patch(':organizationId/members/:membershipId/roles')
  @HttpCode(200)
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('member.manage')
  @ApiOperation({ summary: 'Replace a membership role set with owner lockout protection' })
  async replaceMembershipRoles(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() input: ReplaceMembershipRolesDto,
    @Req() request: Request,
  ): Promise<{ updated: true }> {
    await this.useCases.replaceMembershipRoles(
      principal,
      organizationId,
      membershipId,
      input,
      requestContext(request),
    );
    return { updated: true };
  }
}
