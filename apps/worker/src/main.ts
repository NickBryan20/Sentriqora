import { Worker } from 'bullmq';
import pino from 'pino';

import { redisConnectionFromUrl } from './redis-connection';
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
const worker = new Worker<SystemHealthJob, SystemHealthResult>(
  'aegisflow-system',
  async (job) => processSystemHealthJob(job.data),
  { connection, concurrency: 2 },
);

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

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping AegisFlow worker');
  await worker.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
