import { Queue, Worker } from 'bullmq';
import { createEmbeddingProvider } from '@aegisflow/ai';
import pino from 'pino';

import { redisConnectionFromUrl } from './redis-connection';
import { createDatabasePool } from './database';
import { DetectionProcessor } from './detection.processor';
import { startMetricsServer } from './detection.metrics';
import { EventIngestionProcessor } from './event-ingestion.processor';
import { IncidentProcessor } from './incident.processor';
import { KnowledgeIndexProcessor } from './knowledge-index.processor';
import { MinioKnowledgeReader } from './minio-knowledge-reader';
import { LogEmailNotificationAdapter, NotificationProcessor } from './notification.processor';
import {
  detectionJobSchema,
  incidentJobSchema,
  ingestionJobSchema,
  knowledgeIndexJobSchema,
  notificationJobSchema,
  OutboxDispatcher,
} from './outbox-dispatcher';
import { PayloadCrypto } from './payload-crypto';
import {
  processSystemHealthJob,
  type SystemHealthJob,
  type SystemHealthResult,
} from './system-health.processor';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['password', 'token', 'secret', 'authorization'],
});
const connection = redisConnectionFromUrl(process.env.REDIS_URL ?? 'redis://localhost:6379');
const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.AUTH_ENCRYPTION_KEY;
const tokenPepper = process.env.AUTH_TOKEN_PEPPER;
if (databaseUrl === undefined || encryptionKey === undefined || tokenPepper === undefined) {
  throw new Error('DATABASE_URL, AUTH_ENCRYPTION_KEY and AUTH_TOKEN_PEPPER are required');
}
const pool = createDatabasePool(databaseUrl);
const metricsServer = startMetricsServer(Number(process.env.WORKER_METRICS_PORT ?? 9464));
const ingestionQueue = new Queue('aegisflow-ingestion', { connection });
const detectionQueue = new Queue('aegisflow-detection', { connection });
const incidentQueue = new Queue('aegisflow-incidents', { connection });
const notificationQueue = new Queue('aegisflow-notifications', { connection });
const knowledgeQueue = new Queue('aegisflow-knowledge', { connection });
const processor = new EventIngestionProcessor(
  pool,
  new PayloadCrypto(encryptionKey),
  tokenPepper,
  logger,
);
const detectionProcessor = new DetectionProcessor(pool, logger);
const incidentProcessor = new IncidentProcessor(pool, logger);
const notificationProcessor = new NotificationProcessor(
  pool,
  new LogEmailNotificationAdapter(logger),
  logger,
);
const embeddingProvider = createEmbeddingProvider({
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL,
  ollamaModel: process.env.OLLAMA_MODEL,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL,
  openAiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
  openAiModel: process.env.OPENAI_MODEL,
  provider: parseAiProvider(process.env.AI_PROVIDER),
});
const knowledgeProcessor = new KnowledgeIndexProcessor(
  pool,
  embeddingProvider,
  new MinioKnowledgeReader(
    process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    process.env.MINIO_BUCKET_KNOWLEDGE ?? 'aegisflow-knowledge',
    process.env.MINIO_ACCESS_KEY ?? 'aegisflow_local',
    process.env.MINIO_SECRET_KEY ?? 'change-this-local-minio-password',
  ),
  logger,
);
const outboxDispatcher = new OutboxDispatcher(
  pool,
  ingestionQueue,
  logger,
  detectionQueue,
  incidentQueue,
  notificationQueue,
  knowledgeQueue,
);
const systemWorker = new Worker<SystemHealthJob, SystemHealthResult>(
  'aegisflow-system',
  async (job) => processSystemHealthJob(job.data),
  { connection, concurrency: 2 },
);
const ingestionWorker = new Worker(
  'aegisflow-ingestion',
  async (job) => processor.process(ingestionJobSchema.parse(job.data)),
  { connection, concurrency: 8 },
);
const detectionWorker = new Worker(
  'aegisflow-detection',
  async (job) => detectionProcessor.process(detectionJobSchema.parse(job.data)),
  { connection, concurrency: 8 },
);
const incidentWorker = new Worker(
  'aegisflow-incidents',
  async (job) => incidentProcessor.process(incidentJobSchema.parse(job.data)),
  { connection, concurrency: 4 },
);
const notificationWorker = new Worker(
  'aegisflow-notifications',
  async (job) => notificationProcessor.process(notificationJobSchema.parse(job.data)),
  { connection, concurrency: 4 },
);
const knowledgeWorker = new Worker(
  'aegisflow-knowledge',
  async (job) => knowledgeProcessor.process(knowledgeIndexJobSchema.parse(job.data)),
  { connection, concurrency: 2 },
);
outboxDispatcher.start();

for (const worker of [
  systemWorker,
  ingestionWorker,
  detectionWorker,
  incidentWorker,
  notificationWorker,
  knowledgeWorker,
]) {
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, queue: job.queueName }, 'Background job completed');
  });
  worker.on('failed', (job, error) => {
    logger.error(
      { errorName: error.name, jobId: job?.id, queue: job?.queueName },
      'Background job failed',
    );
  });
  worker.on('ready', () => {
    logger.info({ queue: worker.name }, 'AegisFlow worker is ready');
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping AegisFlow worker');
  await outboxDispatcher.close();
  await Promise.all([
    systemWorker.close(),
    ingestionWorker.close(),
    detectionWorker.close(),
    incidentWorker.close(),
    notificationWorker.close(),
    knowledgeWorker.close(),
  ]);
  await Promise.all([
    ingestionQueue.close(),
    detectionQueue.close(),
    incidentQueue.close(),
    notificationQueue.close(),
    knowledgeQueue.close(),
  ]);
  await pool.end();
  await new Promise<void>((resolve, reject) =>
    metricsServer.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function parseAiProvider(value: string | undefined): 'deterministic' | 'ollama' | 'openai' {
  if (value === undefined || value === 'deterministic') return 'deterministic';
  if (value === 'ollama' || value === 'openai') return value;
  throw new Error('AI_PROVIDER must be deterministic, ollama or openai');
}
