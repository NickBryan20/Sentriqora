import { z } from 'zod';

export const componentHealthSchema = z.object({
  name: z.string().min(1).max(64),
  status: z.enum(['up', 'degraded', 'down']),
  latencyMs: z.number().int().nonnegative().optional(),
});

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  status: z.enum(['up', 'degraded', 'down']),
  timestamp: z.iso.datetime({ offset: true }),
  version: z.string().min(1),
  components: z.array(componentHealthSchema).optional(),
});

export type ComponentHealth = z.infer<typeof componentHealthSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
