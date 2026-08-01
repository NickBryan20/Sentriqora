import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { EventUseCases } from './application/event.use-cases';
import { EVENT_REPOSITORY_PORT } from './application/ports/event-repository.port';
import { PrismaEventRepository } from './infrastructure/prisma-event.repository';
import { EventsController } from './presentation/events.controller';

@Module({
  controllers: [EventsController],
  imports: [IdentityModule],
  providers: [
    EventUseCases,
    PrismaEventRepository,
    { provide: EVENT_REPOSITORY_PORT, useExisting: PrismaEventRepository },
  ],
})
export class EventModule {}
