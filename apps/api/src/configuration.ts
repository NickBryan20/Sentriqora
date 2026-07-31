import { z } from 'zod';

const environmentSchema = z.object({
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:8080,http://localhost:3000'),
  DATABASE_URL: z.url().default('postgresql://postgres:200520@localhost:5432/aegisflow_db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MINIO_ENDPOINT: z.url().default('http://localhost:9000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().min(1).default('aegisflow-api'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(values: Record<string, unknown>): Environment {
  return environmentSchema.parse(values);
}
