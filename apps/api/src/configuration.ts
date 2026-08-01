import { z } from 'zod';

const developmentSecrets = {
  encryption: 'ZGV2LW9ubHktYWVzLWtleS0zMi1ieXRlcy1sb25nISE=',
  jwt: 'dev-only-jwt-secret-change-before-production-2026',
  pepper: 'dev-only-token-pepper-change-before-production-2026',
} as const;

const booleanEnvironment = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z
  .object({
    AI_PROVIDER: z.enum(['deterministic', 'ollama', 'openai']).default('deterministic'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    AUTH_AUDIENCE: z.string().min(3).max(120).default('aegisflow-web'),
    AUTH_ENCRYPTION_KEY: z
      .string()
      .default(developmentSecrets.encryption)
      .refine((value) => Buffer.from(value, 'base64').byteLength === 32, {
        message: 'AUTH_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      }),
    AUTH_ISSUER: z.string().min(3).max(120).default('aegisflow-api'),
    AUTH_JWT_SECRET: z.string().min(32).default(developmentSecrets.jwt),
    AUTH_TOKEN_PEPPER: z.string().min(32).default(developmentSecrets.pepper),
    COOKIE_SECURE: booleanEnvironment.default(false),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:8080,http://localhost:3000'),
    DATABASE_URL: z.url().default('postgresql://postgres:200520@localhost:5432/aegisflow_db'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    MINIO_ENDPOINT: z.url().default('http://localhost:9000'),
    MINIO_PUBLIC_ENDPOINT: z.url().default('http://localhost:9000'),
    MINIO_ACCESS_KEY: z.string().min(3).max(128).default('aegisflow_local'),
    MINIO_SECRET_KEY: z.string().min(16).max(256).default('change-this-local-minio-password'),
    MINIO_BUCKET_EVIDENCE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u)
      .default('aegisflow-evidence'),
    MINIO_BUCKET_KNOWLEDGE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u)
      .default('aegisflow-knowledge'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
    OLLAMA_EMBEDDING_MODEL: z.string().min(1).max(120).default('nomic-embed-text'),
    OLLAMA_MODEL: z.string().min(1).max(120).default('gpt-oss:20b'),
    OPENAI_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(20).optional(),
    ),
    OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).max(120).default('text-embedding-3-small'),
    OPENAI_MODEL: z.string().min(1).max(120).default('gpt-5.6-sol'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default('http://localhost:4318'),
    OTEL_SERVICE_NAME: z.string().min(1).default('aegisflow-api'),
    REDIS_URL: z.url().default('redis://localhost:6379'),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3_600).max(2_592_000).default(2_592_000),
  })
  .superRefine((environment, context) => {
    if (environment.AI_PROVIDER === 'openai' && environment.OPENAI_API_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai',
      });
    }
    if (environment.NODE_ENV !== 'production') {
      return;
    }
    if (!environment.COOKIE_SECURE) {
      context.addIssue({ code: 'custom', message: 'COOKIE_SECURE must be true in production' });
    }
    if (
      environment.AUTH_JWT_SECRET === developmentSecrets.jwt ||
      environment.AUTH_TOKEN_PEPPER === developmentSecrets.pepper ||
      environment.AUTH_ENCRYPTION_KEY === developmentSecrets.encryption ||
      environment.MINIO_SECRET_KEY === 'change-this-local-minio-password'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Development identity secrets are forbidden in production',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(values: Record<string, unknown>): Environment {
  return environmentSchema.parse(values);
}
