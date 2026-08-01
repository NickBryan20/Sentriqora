import type { AuthPrincipal } from '@aegisflow/contracts';
import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessTokenGuard } from '../../identity/presentation/guards/access-token.guard';
import {
  PermissionsGuard,
  Principal,
  RequirePermissions,
  TenantGuard,
} from '../../identity/presentation/guards/authorization.guards';
import { EventUseCases } from '../application/event.use-cases';
import { ListEventsDto } from './event.dto';

const listEventsValidationPipe = new ValidationPipe({
  expectedType: ListEventsDto,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
  whitelist: true,
});

@ApiTags('Events')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId')
@UseGuards(AccessTokenGuard, TenantGuard, PermissionsGuard)
export class EventsController {
  constructor(@Inject(EventUseCases) private readonly useCases: EventUseCases) {}

  @Get('events')
  @RequirePermissions('event.read')
  @ApiOperation({ summary: 'List masked normalized events using cursor pagination' })
  listEvents(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query(listEventsValidationPipe) query: ListEventsDto,
  ) {
    return this.useCases.listEvents(principal, organizationId, query);
  }

  @Get('event-ingestion/receipts/:receiptId')
  @RequirePermissions('event.read')
  @ApiOperation({ summary: 'Get an ingestion receipt without exposing its raw payload' })
  getReceipt(
    @Principal() principal: AuthPrincipal,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('receiptId', new ParseUUIDPipe()) receiptId: string,
  ) {
    return this.useCases.getReceipt(principal, organizationId, receiptId);
  }
}
