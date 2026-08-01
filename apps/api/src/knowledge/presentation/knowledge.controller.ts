import type { AuthPrincipal } from '@aegisflow/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiExtraModels, ApiOperation, ApiTags } from '@nestjs/swagger';

import { KnowledgeUseCases } from '../application/knowledge.use-cases';
import { AccessTokenGuard } from '../../identity/presentation/guards/access-token.guard';
import {
  MfaVerifiedGuard,
  PermissionsGuard,
  Principal,
  RequirePermissions,
  TenantGuard,
} from '../../identity/presentation/guards/authorization.guards';
import { CsrfGuard } from '../../identity/presentation/guards/csrf.guard';
import {
  CreateKnowledgeDocumentDto,
  CreateKnowledgeVersionDto,
  RequestRecommendationDto,
} from './knowledge.dto';

@ApiTags('Knowledge and AI recommendations')
@ApiExtraModels(CreateKnowledgeDocumentDto, CreateKnowledgeVersionDto, RequestRecommendationDto)
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId')
@UseGuards(AccessTokenGuard, TenantGuard, PermissionsGuard)
export class KnowledgeController {
  constructor(@Inject(KnowledgeUseCases) private readonly useCases: KnowledgeUseCases) {}

  @Get('knowledge-documents')
  @RequirePermissions('knowledge.read')
  @ApiOperation({ summary: 'List tenant knowledge documents and indexing state' })
  listDocuments(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.useCases.listDocuments(principal, organizationId);
  }

  @Post('knowledge-documents')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Create and asynchronously index a sanitized knowledge document' })
  createDocument(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateKnowledgeDocumentDto,
  ) {
    return this.useCases.createDocument(principal, organizationId, input);
  }

  @Post('knowledge-documents/:documentId/versions')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Create and asynchronously index a new document version' })
  createVersion(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() input: CreateKnowledgeVersionDto,
  ) {
    return this.useCases.createVersion(principal, organizationId, documentId, input);
  }

  @Delete('knowledge-documents/:documentId')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('knowledge.manage')
  @ApiOperation({ summary: 'Securely remove document objects and neutralize indexed content' })
  deleteDocument(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ) {
    return this.useCases.deleteDocument(principal, organizationId, documentId);
  }

  @Get('ai-recommendations')
  @RequirePermissions('knowledge.read')
  @ApiOperation({ summary: 'List grounded recommendations with persisted source snapshots' })
  listRecommendations(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query('incidentId', new ParseUUIDPipe({ optional: true })) incidentId?: string,
  ) {
    return this.useCases.listRecommendations(principal, organizationId, incidentId);
  }

  @Post('ai-recommendations')
  @UseGuards(CsrfGuard)
  @RequirePermissions('ai-recommendation.request')
  @ApiOperation({ summary: 'Request a bounded RAG recommendation that cites sources or abstains' })
  requestRecommendation(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: RequestRecommendationDto,
  ) {
    return this.useCases.requestRecommendation(principal, organizationId, input);
  }
}
