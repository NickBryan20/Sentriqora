import { Queue, Worker } from 'bullmq';
import pino from 'pino';

import { redisConnectionFromUrl } from './redis-connection';
import { createDatabasePool } from './database';
import { DetectionProcessor } from './detection.processor';
import { startMetricsServer } from './detection.metrics';
import { EventIngestionProcessor } from './event-ingestion.processor';
import { IncidentProcessor } from './incident.processor';
import { LogEmailNotificationAdapter, NotificationProcessor } from './notification.processor';
import {
  detectionJobSchema,
  incidentJobSchema,
  ingestionJobSchema,
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
const outboxDispatcher = new OutboxDispatcher(
  pool,
  ingestionQueue,
  logger,
  detectionQueue,
  incidentQueue,
  notificationQueue,
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
outboxDispatcher.start();

for (const worker of [
  systemWorker,
  ingestionWorker,
  detectionWorker,
  incidentWorker,
  notificationWorker,
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
  ]);
  await Promise.all([
    ingestionQueue.close(),
    detectionQueue.close(),
    incidentQueue.close(),
    notificationQueue.close(),
  ]);
  await pool.end();
  await new Promise<void>((resolve, reject) =>
    metricsServer.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
