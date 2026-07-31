import { Inject, Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export interface TenantDatabaseContext {
  organizationId: string | null;
  userId: string | null;
}

@Injectable()
export class TenantPrismaExecutor {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  run<T>(
    context: TenantDatabaseContext,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe('SET LOCAL ROLE aegisflow_app');
      await transaction.$queryRaw`
        SELECT
          set_config('app.current_organization_id', ${context.organizationId ?? ''}, true),
          set_config('app.current_user_id', ${context.userId ?? ''}, true)
      `;
      return operation(transaction);
    });
  }
}
