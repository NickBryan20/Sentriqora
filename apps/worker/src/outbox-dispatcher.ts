import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { Pool } from 'pg';
import { z } from 'zod';

export const ingestionJobSchema = z.object({
  connectorId: z.uuid(),
  correlationId: z.string().min(8).max(128),
  organizationId: z.uuid(),
  rawEventId: z.uuid(),
});
export type IngestionJob = z.infer<typeof ingestionJobSchema>;
export const detectionJobSchema = z.object({
  organizationId: z.uuid(),
  rawEventId: z.uuid(),
});
export type DetectionJob = z.infer<typeof detectionJobSchema>;

interface ClaimedOutboxEvent {
  event_type: string;
  id: string;
  payload: unknown;
  retry_count: number;
}

export class OutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(
    private readonly pool: Pool,
    private readonly ingestionQueue: Queue<IngestionJob>,
    private readonly logger: Logger,
    private readonly detectionQueue?: Queue<DetectionJob>,
  ) {}

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.poll(), 250);
    this.timer.unref();
    void this.poll();
  }

  async close(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    while (this.polling) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const claimed = await this.claim();
      for (const event of claimed) {
        await this.publish(event);
      }
    } catch (error) {
      this.logger.error({ errorName: errorName(error) }, 'Outbox dispatch cycle failed');
    } finally {
      this.polling = false;
    }
  }

  private async claim(): Promise<ClaimedOutboxEvent[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE aegisflow_outbox');
      const result = await client.query<ClaimedOutboxEvent>(`
        WITH candidates AS (
          SELECT id
          FROM outbox_events
          WHERE event_type IN ('raw_event.received.v1', 'normalized_event.batch_created.v1')
            AND status IN ('PENDING', 'PROCESSING')
            AND available_at <= now()
            AND retry_count < 10
          ORDER BY occurred_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 200
        )
        UPDATE outbox_events AS event
        SET status = 'PROCESSING',
            retry_count = event.retry_count + 1,
            available_at = now() + interval '1 minute',
            last_error_code = NULL
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.id, event.event_type, event.payload, event.retry_count
      `);
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async publish(event: ClaimedOutboxEvent): Promise<void> {
    try {
      const isIngestion = event.event_type === 'raw_event.received.v1';
      const payload = isIngestion
        ? ingestionJobSchema.parse(event.payload)
        : detectionJobSchema.parse(event.payload);
      const queue = isIngestion
        ? this.ingestionQueue
        : (this.detectionQueue ?? (this.ingestionQueue as unknown as Queue<DetectionJob>));
      await queue.add(isIngestion ? 'normalize-raw-event' : 'detect-normalized-batch', payload, {
        attempts: 5,
        backoff: { delay: 1_000, type: 'exponential' },
        jobId: `${isIngestion ? 'ingestion' : 'detection'}-${payload.rawEventId}`,
        removeOnComplete: { age: 3_600, count: 10_000 },
        removeOnFail: { age: 86_400, count: 10_000 },
      });
      await this.updatePublished(event.id);
    } catch (error) {
      await this.updateFailed(event.id, event.retry_count, errorName(error));
      this.logger.warn(
        { errorName: errorName(error), outboxEventId: event.id },
        'Outbox event was not published',
      );
    }
  }

  private async updatePublished(id: string): Promise<void> {
    await this.withOutboxRole(
      `UPDATE outbox_events
       SET status = 'PUBLISHED', published_at = now(), last_error_code = NULL
       WHERE id = $1 AND status = 'PROCESSING'`,
      [id],
    );
  }

  private async updateFailed(id: string, retryCount: number, code: string): Promise<void> {
    const failed = retryCount >= 10;
    await this.withOutboxRole(
      `UPDATE outbox_events
       SET status = $2::outbox_status,
           available_at = now() + make_interval(secs => LEAST(300, power(2, retry_count)::integer)),
           last_error_code = $3
       WHERE id = $1 AND status = 'PROCESSING'`,
      [id, failed ? 'FAILED' : 'PENDING', code.slice(0, 100)],
    );
  }

  private async withOutboxRole(sql: string, parameters: unknown[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE aegisflow_outbox');
      await client.query(sql, parameters);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
