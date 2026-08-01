import type { AuthPrincipal } from '@aegisflow/contracts';
import type { MessageEvent } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiExtraModels, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { interval, map, startWith, switchMap, type Observable } from 'rxjs';

import { IncidentUseCases } from '../application/incident.use-cases';
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
  AddIncidentCommentDto,
  AssignIncidentDto,
  CompleteEvidenceUploadDto,
  CreateIncidentDto,
  ListIncidentsDto,
  RequestEvidenceUploadDto,
  TransitionIncidentDto,
  UpdateIncidentAnalysisDto,
  UpdateSlaPolicyDto,
} from './incident.dto';

const listValidationPipe = new ValidationPipe({
  expectedType: ListIncidentsDto,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
  whitelist: true,
});

@ApiTags('Incidents')
@ApiExtraModels(
  AddIncidentCommentDto,
  AssignIncidentDto,
  CompleteEvidenceUploadDto,
  CreateIncidentDto,
  ListIncidentsDto,
  RequestEvidenceUploadDto,
  TransitionIncidentDto,
  UpdateIncidentAnalysisDto,
  UpdateSlaPolicyDto,
)
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId')
@UseGuards(AccessTokenGuard, TenantGuard, PermissionsGuard)
export class IncidentController {
  constructor(@Inject(IncidentUseCases) private readonly useCases: IncidentUseCases) {}

  @Get('incidents')
  @RequirePermissions('incident.read')
  @ApiOperation({ summary: 'List tenant incidents with cursor pagination and SLA filters' })
  list(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query(listValidationPipe) query: ListIncidentsDto,
  ) {
    return this.useCases.listIncidents(principal, organizationId, query);
  }

  @Post('incidents')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('incident.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create an incident from one or more alerts idempotently' })
  async create(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateIncidentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.createIncident(
      principal,
      organizationId,
      input,
      idempotencyKey,
    );
    response.setHeader('idempotency-replayed', String(result.replayed));
    return result.value;
  }

  @Sse('incidents/stream')
  @RequirePermissions('incident.read')
  @ApiOperation({ summary: 'Stream bounded incident snapshots using SSE' })
  stream(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Observable<MessageEvent> {
    return interval(2_000).pipe(
      startWith(0),
      switchMap(() => this.useCases.listIncidents(principal, organizationId, { limit: 20 })),
      map((data) => ({ data, type: 'incidents.snapshot' })),
    );
  }

  @Get('incidents/:incidentId')
  @RequirePermissions('incident.read')
  @ApiOperation({ summary: 'Get incident details, evidence, comments and timeline' })
  get(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
  ) {
    return this.useCases.getIncident(principal, organizationId, incidentId);
  }

  @Get('incidents/:incidentId/graph')
  @RequirePermissions('incident.read')
  @ApiOperation({ summary: 'Get the bounded incident-alert-asset correlation graph' })
  graph(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
  ) {
    return this.useCases.getIncidentGraph(principal, organizationId, incidentId);
  }

  @Post('incidents/:incidentId/assignment')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('incident.manage')
  @ApiOperation({ summary: 'Assign an incident with optimistic concurrency' })
  assign(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Body() input: AssignIncidentDto,
  ) {
    return this.useCases.assign(principal, organizationId, incidentId, input);
  }

  @Post('incidents/:incidentId/transitions')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('incident.manage')
  @ApiOperation({ summary: 'Execute a validated incident lifecycle transition' })
  transition(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Body() input: TransitionIncidentDto,
  ) {
    return this.useCases.transition(principal, organizationId, incidentId, input);
  }

  @Patch('incidents/:incidentId/analysis')
  @UseGuards(CsrfGuard)
  @RequirePermissions('incident.manage')
  @ApiOperation({ summary: 'Update root cause and lessons learned atomically' })
  updateAnalysis(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Body() input: UpdateIncidentAnalysisDto,
  ) {
    return this.useCases.updateAnalysis(principal, organizationId, incidentId, input);
  }

  @Post('incidents/:incidentId/comments')
  @UseGuards(CsrfGuard)
  @RequirePermissions('incident.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Add an append-only incident comment idempotently' })
  async addComment(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Body() input: AddIncidentCommentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.addComment(
      principal,
      organizationId,
      incidentId,
      input,
      idempotencyKey,
    );
    response.setHeader('idempotency-replayed', String(result.replayed));
    return result.value;
  }

  @Post('incidents/:incidentId/evidence/upload-requests')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('incident.evidence')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create a bounded private MinIO upload authorization' })
  async requestEvidence(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Body() input: RequestEvidenceUploadDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.requestEvidenceUpload(
      principal,
      organizationId,
      incidentId,
      input,
      idempotencyKey,
    );
    response.setHeader('idempotency-replayed', String(result.replayed));
    return { evidence: result.value, upload: result.upload };
  }

  @Post('incidents/:incidentId/evidence/:evidenceId/completion')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('incident.evidence')
  @ApiOperation({
    summary: 'Verify hash, metadata, MIME and active content before evidence release',
  })
  completeEvidence(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
    @Body() input: CompleteEvidenceUploadDto,
  ) {
    return this.useCases.completeEvidenceUpload(
      principal,
      organizationId,
      incidentId,
      evidenceId,
      input,
    );
  }

  @Get('incidents/:incidentId/evidence/:evidenceId/download-url')
  @UseGuards(MfaVerifiedGuard)
  @RequirePermissions('incident.evidence')
  @ApiOperation({ summary: 'Get a short-lived URL for verified private evidence' })
  downloadEvidence(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('incidentId', new ParseUUIDPipe()) incidentId: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
  ) {
    return this.useCases.getEvidenceDownload(principal, organizationId, incidentId, evidenceId);
  }

  @Get('sla-policies')
  @RequirePermissions('incident.read')
  @ApiOperation({ summary: 'List incident SLA policies' })
  listSlaPolicies(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.useCases.listSlaPolicies(principal, organizationId);
  }

  @Patch('sla-policies/:policyId')
  @UseGuards(MfaVerifiedGuard, CsrfGuard)
  @RequirePermissions('sla-policy.manage')
  @ApiOperation({ summary: 'Update an SLA policy with optimistic concurrency' })
  updateSlaPolicy(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('policyId', new ParseUUIDPipe()) policyId: string,
    @Body() input: UpdateSlaPolicyDto,
  ) {
    return this.useCases.updateSlaPolicy(principal, organizationId, policyId, input);
  }

  @Get('notifications')
  @RequirePermissions('notification.read')
  @ApiOperation({ summary: 'List internal incident notifications' })
  notifications(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.useCases.listNotifications(principal, organizationId, limit);
  }

  @Post('notifications/:notificationId/read')
  @UseGuards(CsrfGuard)
  @RequirePermissions('notification.read')
  @ApiOperation({ summary: 'Mark an accessible internal notification as read' })
  markNotificationRead(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
  ) {
    return this.useCases.markNotificationRead(principal, organizationId, notificationId);
  }
}
