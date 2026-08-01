import type { AuthPrincipal } from '@aegisflow/contracts';
import type { MessageEvent } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { interval, map, startWith, switchMap, type Observable } from 'rxjs';

import { AccessTokenGuard } from '../../identity/presentation/guards/access-token.guard';
import {
  PermissionsGuard,
  Principal,
  RequirePermissions,
  TenantGuard,
} from '../../identity/presentation/guards/authorization.guards';
import { CsrfGuard } from '../../identity/presentation/guards/csrf.guard';
import { recordDetectionCommand } from '../../metrics/detection.metrics';
import { DetectionUseCases } from '../application/detection.use-cases';
import type {
  CreateDetectionRuleDto,
  SetDetectionRuleEnabledDto,
  SuppressAlertDto,
  TriageAlertDto,
  UpdateDetectionRuleDto,
} from './detection.dto';
import { ListAlertsDto } from './detection.dto';

const listAlertsValidationPipe = new ValidationPipe({
  expectedType: ListAlertsDto,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
  whitelist: true,
});

@ApiTags('Detection & Alerts')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId')
@UseGuards(AccessTokenGuard, TenantGuard, PermissionsGuard)
export class DetectionController {
  constructor(@Inject(DetectionUseCases) private readonly useCases: DetectionUseCases) {}

  @Get('detection-rules')
  @RequirePermissions('detection-rule.read')
  @ApiOperation({ summary: 'List tenant detection rules and their active versions' })
  listRules(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.useCases.listRules(principal, organizationId);
  }

  @Post('detection-rules')
  @UseGuards(CsrfGuard)
  @RequirePermissions('detection-rule.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Create a versioned deterministic rule idempotently' })
  async createRule(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() input: CreateDetectionRuleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.useCases.createRule(
      principal,
      organizationId,
      input,
      idempotencyKey,
      context(request),
    );
    response.setHeader('idempotency-replayed', String(result.replayed));
    recordDetectionCommand('rule.create', 'success');
    return result.value;
  }

  @Patch('detection-rules/:ruleId')
  @UseGuards(CsrfGuard)
  @RequirePermissions('detection-rule.manage')
  @ApiOperation({ summary: 'Create a new immutable version of a rule' })
  updateRule(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Body() input: UpdateDetectionRuleDto,
  ) {
    return this.useCases.updateRule(principal, organizationId, ruleId, input);
  }

  @Post('detection-rules/:ruleId/activation')
  @UseGuards(CsrfGuard)
  @RequirePermissions('detection-rule.manage')
  @ApiOperation({ summary: 'Enable or disable a detection rule explicitly' })
  setRuleEnabled(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Body() input: SetDetectionRuleEnabledDto,
  ) {
    return this.useCases.setRuleEnabled(principal, organizationId, ruleId, input);
  }

  @Get('alerts')
  @RequirePermissions('alert.read')
  @ApiOperation({ summary: 'List alerts with cursor pagination and bounded filters' })
  listAlerts(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query(listAlertsValidationPipe) query: ListAlertsDto,
  ) {
    return this.useCases.listAlerts(principal, organizationId, query);
  }

  @Sse('alerts/stream')
  @RequirePermissions('alert.read')
  @ApiOperation({ summary: 'Stream the most recent alert snapshots using SSE' })
  streamAlerts(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ): Observable<MessageEvent> {
    return interval(2_000).pipe(
      startWith(0),
      switchMap(() => this.useCases.listAlerts(principal, organizationId, { limit: 20 })),
      map((value) => ({ data: value, type: 'alerts.snapshot' })),
    );
  }

  @Get('alerts/:alertId')
  @RequirePermissions('alert.read')
  @ApiOperation({ summary: 'Get an alert with its masked event evidence' })
  getAlert(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('alertId', new ParseUUIDPipe()) alertId: string,
  ) {
    return this.useCases.getAlert(principal, organizationId, alertId);
  }

  @Get('alerts/:alertId/graph')
  @RequirePermissions('alert.read')
  @ApiOperation({ summary: 'Get the bounded correlation graph around an alert' })
  getGraph(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('alertId', new ParseUUIDPipe()) alertId: string,
  ) {
    return this.useCases.getAlertGraph(principal, organizationId, alertId);
  }

  @Post('alerts/:alertId/triage')
  @UseGuards(CsrfGuard)
  @RequirePermissions('alert.triage')
  @ApiOperation({ summary: 'Acknowledge, assign or close an alert with optimistic concurrency' })
  triageAlert(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('alertId', new ParseUUIDPipe()) alertId: string,
    @Body() input: TriageAlertDto,
  ) {
    return this.useCases.triageAlert(principal, organizationId, alertId, input);
  }

  @Post('alerts/:alertId/suppression')
  @UseGuards(CsrfGuard)
  @RequirePermissions('alert.triage')
  @ApiOperation({ summary: 'Suppress an alert temporarily with a mandatory reason' })
  suppressAlert(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('alertId', new ParseUUIDPipe()) alertId: string,
    @Body() input: SuppressAlertDto,
  ) {
    return this.useCases.suppressAlert(principal, organizationId, alertId, input);
  }
}

function context(request: Request) {
  return {
    correlationId: request.header('x-correlation-id') ?? 'unavailable',
    ipAddress: request.ip || request.socket.remoteAddress || '0.0.0.0',
  };
}
