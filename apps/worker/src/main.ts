import { Queue, Worker } from 'bullmq';
import pino from 'pino';

import { redisConnectionFromUrl } from './redis-connection';
import { createDatabasePool } from './database';
import { EventIngestionProcessor } from './event-ingestion.processor';
import { ingestionJobSchema, OutboxDispatcher } from './outbox-dispatcher';
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
const ingestionQueue = new Queue('aegisflow-ingestion', { connection });
const processor = new EventIngestionProcessor(
  pool,
  new PayloadCrypto(encryptionKey),
  tokenPepper,
  logger,
);
const outboxDispatcher = new OutboxDispatcher(pool, ingestionQueue, logger);
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
outboxDispatcher.start();

for (const worker of [systemWorker, ingestionWorker]) {
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
  await Promise.all([systemWorker.close(), ingestionWorker.close()]);
  await ingestionQueue.close();
  await pool.end();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
