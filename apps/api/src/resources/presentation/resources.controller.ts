import type { AuthPrincipal } from '@aegisflow/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AccessTokenGuard } from '../../identity/presentation/guards/access-token.guard';
import {
  MfaVerifiedGuard,
  PermissionsGuard,
  Principal,
  RequirePermissions,
  TenantGuard,
} from '../../identity/presentation/guards/authorization.guards';
import { CsrfGuard } from '../../identity/presentation/guards/csrf.guard';
import { ResourceUseCases } from '../application/resource.use-cases';
import type {
  CreateApiKeyDto,
  CreateAssetDependencyDto,
  CreateAssetDto,
  CreateConnectorDto,
  RotateWebhookSecretDto,
  UpdateAssetDto,
  UpdateConnectorDto,
} from './resource.dto';

@ApiTags('Assets & Connectors')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId')
@UseGuards(AccessTokenGuard, TenantGuard, PermissionsGuard)
export class ResourcesController {
  constructor(@Inject(ResourceUseCases) private readonly useCases: ResourceUseCases) {}

  @Get('assets')
  @RequirePermissions('asset.read')
  @ApiOperation({ summary: 'List the active tenant asset inventory' })
  listAssets(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.useCases.listAssets(principal, organizationId);
  }

  @Get('assets/:assetId')
  @RequirePermissions('asset.read')
  @ApiOperation({ summary: 'Get an asset and its dependency graph edges' })
  getAsset(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ) {
    return this.useCases.getAsset(principal, organizationId, assetId);
  }

  @Post('assets')
  @UseGuards(CsrfGuard)
  @RequirePermissions('asset.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create an asset idempotently' })
  async createAsset(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateAssetDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.createAsset(
      principal,
      organizationId,
      input,
      idempotencyKey,
      resourceContext(request),
    );
    markReplay(response, result.replayed);
    return result.value;
  }

  @Patch('assets/:assetId')
  @UseGuards(CsrfGuard)
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Update an asset using optimistic concurrency' })
  updateAsset(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Body() input: UpdateAssetDto,
    @Req() request: Request,
  ) {
    return this.useCases.updateAsset(
      principal,
      organizationId,
      assetId,
      input,
      resourceContext(request),
    );
  }

  @Delete('assets/:assetId')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Archive an asset without destroying its history' })
  archiveAsset(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Req() request: Request,
  ) {
    return this.useCases.archiveAsset(principal, organizationId, assetId, resourceContext(request));
  }

  @Post('assets/:assetId/dependencies')
  @UseGuards(CsrfGuard)
  @RequirePermissions('asset.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create a typed asset dependency idempotently' })
  async addDependency(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Body() input: CreateAssetDependencyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.addDependency(
      principal,
      organizationId,
      assetId,
      input,
      idempotencyKey,
      resourceContext(request),
    );
    markReplay(response, result.replayed);
    return result.value;
  }

  @Delete('assets/:assetId/dependencies/:dependencyId')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  @RequirePermissions('asset.manage')
  @ApiOperation({ summary: 'Delete an asset dependency edge' })
  removeDependency(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Param('dependencyId', new ParseUUIDPipe()) dependencyId: string,
    @Req() request: Request,
  ) {
    return this.useCases.removeDependency(
      principal,
      organizationId,
      assetId,
      dependencyId,
      resourceContext(request),
    );
  }

  @Get('connectors')
  @RequirePermissions('connector.read')
  @ApiOperation({ summary: 'List tenant connector definitions without credentials' })
  listConnectors(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.useCases.listConnectors(principal, organizationId);
  }

  @Get('connectors/:connectorId')
  @RequirePermissions('connector.read')
  @ApiOperation({ summary: 'Get a connector definition without credentials' })
  getConnector(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
  ) {
    return this.useCases.getConnector(principal, organizationId, connectorId);
  }

  @Post('connectors')
  @UseGuards(CsrfGuard)
  @RequirePermissions('connector.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create a connector definition idempotently' })
  async createConnector(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateConnectorDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.createConnector(
      principal,
      organizationId,
      input,
      idempotencyKey,
      resourceContext(request),
    );
    markReplay(response, result.replayed);
    return result.value;
  }

  @Patch('connectors/:connectorId')
  @UseGuards(CsrfGuard)
  @RequirePermissions('connector.manage')
  @ApiOperation({ summary: 'Update a connector using optimistic concurrency' })
  updateConnector(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
    @Body() input: UpdateConnectorDto,
    @Req() request: Request,
  ) {
    return this.useCases.updateConnector(
      principal,
      organizationId,
      connectorId,
      input,
      resourceContext(request),
    );
  }

  @Delete('connectors/:connectorId')
  @HttpCode(204)
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('connector.manage')
  @ApiOperation({ summary: 'Disable a connector and revoke all its credentials' })
  disableConnector(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
    @Req() request: Request,
  ) {
    return this.useCases.disableConnector(
      principal,
      organizationId,
      connectorId,
      resourceContext(request),
    );
  }

  @Post('connectors/:connectorId/webhook-secrets/rotate')
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('connector.secret.rotate')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Rotate a webhook secret and reveal it once' })
  async rotateWebhookSecret(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
    @Body() input: RotateWebhookSecretDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.rotateWebhookSecret(
      principal,
      organizationId,
      connectorId,
      input,
      idempotencyKey,
      resourceContext(request),
    );
    markReplay(response, result.replayed);
    return result.value;
  }

  @Get('connectors/:connectorId/api-keys')
  @RequirePermissions('api-key.read')
  @ApiOperation({ summary: 'List API key metadata without token material' })
  listApiKeys(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
  ) {
    return this.useCases.listApiKeys(principal, organizationId, connectorId);
  }

  @Post('connectors/:connectorId/api-keys')
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('api-key.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Issue an API key and reveal its token once' })
  async createApiKey(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
    @Body() input: CreateApiKeyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.createApiKey(
      principal,
      organizationId,
      connectorId,
      input,
      idempotencyKey,
      resourceContext(request),
    );
    markReplay(response, result.replayed);
    return result.value;
  }

  @Delete('connectors/:connectorId/api-keys/:apiKeyId')
  @HttpCode(204)
  @UseGuards(CsrfGuard, MfaVerifiedGuard)
  @RequirePermissions('api-key.manage')
  @ApiOperation({ summary: 'Revoke an API key immediately' })
  revokeApiKey(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('connectorId', new ParseUUIDPipe()) connectorId: string,
    @Param('apiKeyId', new ParseUUIDPipe()) apiKeyId: string,
    @Req() request: Request,
  ) {
    return this.useCases.revokeApiKey(
      principal,
      organizationId,
      connectorId,
      apiKeyId,
      resourceContext(request),
    );
  }
}

function markReplay(response: Response, replayed: boolean): void {
  response.setHeader('Idempotency-Replayed', replayed ? 'true' : 'false');
}

function resourceContext(request: Request): { correlationId: string; ipAddress: string } {
  return {
    correlationId: request.header('x-correlation-id') ?? 'unavailable',
    ipAddress: request.ip || request.socket.remoteAddress || '0.0.0.0',
  };
}
