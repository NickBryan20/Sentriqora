import { z } from 'zod';

const systemHealthJobSchema = z.object({
  correlationId: z.string().min(8).max(128),
  requestedAt: z.iso.datetime({ offset: true }),
});

export type SystemHealthJob = z.infer<typeof systemHealthJobSchema>;

export interface SystemHealthResult {
  checkedAt: string;
  correlationId: string;
  status: 'processed';
}

export function processSystemHealthJob(payload: unknown): SystemHealthResult {
  const job = systemHealthJobSchema.parse(payload);

  return {
    checkedAt: new Date().toISOString(),
    correlationId: job.correlationId,
    status: 'processed',
  };
}
