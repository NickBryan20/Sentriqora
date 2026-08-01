import { Queue, Worker } from 'bullmq';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pino from 'pino';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabasePool } from '../src/database';
import { DetectionProcessor } from '../src/detection.processor';
import { EventIngestionProcessor } from '../src/event-ingestion.processor';
import { type DetectionJob, type IngestionJob, OutboxDispatcher } from '../src/outbox-dispatcher';
import { PayloadCrypto } from '../src/payload-crypto';
import { redisConnectionFromUrl } from '../src/redis-connection';

const { Client } = pg;

describe('event ingestion pipeline', () => {
  let postgresContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let databaseUrl: string;

  beforeAll(async () => {
    postgresContainer = await new GenericContainer('pgvector/pgvector:0.8.1-pg17-bookworm')
      .withEnvironment({
        POSTGRES_DB: 'aegisflow_worker_test',
        POSTGRES_PASSWORD: 'test-only-password',
        POSTGRES_USER: 'postgres',
      })
      .withExposedPorts(5432)
      .withStartupTimeout(120_000)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
      .start();
    redisContainer = await new GenericContainer('redis:8.2.1-alpine')
      .withExposedPorts(6379)
      .withStartupTimeout(120_000)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/u))
      .start();
    databaseUrl = `postgresql://postgres:test-only-password@${reachableHost(postgresContainer)}:${postgresContainer.getMappedPort(5432)}/aegisflow_worker_test`;
    await applyMigrations(databaseUrl);
  });

  afterAll(async () => {
    await redisContainer?.stop();
    await postgresContainer?.stop();
  });

  it('dispatches through Redis, masks data, deduplicates processing and enforces RLS', async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const connectorId = randomUUID();
    const rawEventId = randomUUID();
    const userId = randomUUID();
    const ruleId = randomUUID();
    const correlationId = `worker-${randomUUID()}`;
    const encryptionKey = randomBytes(32);
    const text = JSON.stringify({
      actor: { ip: '203.0.113.42', user: 'private@example.test' },
      attributes: {
        authorization: 'Bearer extremely-sensitive-token',
        email: 'private@example.test',
        sourceIp: '198.51.100.7',
      },
      eventId: 'worker-integration-1',
      eventType: 'authentication.failed',
      message: 'Failed for private@example.test from 203.0.113.42',
      occurredAt: new Date().toISOString(),
      severity: 'HIGH',
    });
    const encrypted = encrypt(text, encryptionKey);
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `INSERT INTO organizations (id, name, slug) VALUES
         ($1, 'Worker Tenant', $2), ($3, 'Other Tenant', $4)`,
      [
        organizationId,
        `worker-${organizationId.slice(0, 8)}`,
        otherOrganizationId,
        `other-${otherOrganizationId.slice(0, 8)}`,
      ],
    );
    await admin.query(
      `INSERT INTO users (id, email, normalized_email, display_name)
       VALUES ($1, $2, $2, 'Detection Owner')`,
      [userId, `detection-${userId}@example.test`],
    );
    await admin.query(
      `INSERT INTO connectors (id, organization_id, key, name, type)
       VALUES ($1, $2, 'simulator-source', 'Simulator source', 'SIMULATOR')`,
      [connectorId, organizationId],
    );
    await admin.query(
      `INSERT INTO raw_events (
         id, organization_id, connector_id, format, content_type, source_event_id,
         deduplication_key, payload_hash, encrypted_payload, encryption_iv,
         encryption_auth_tag, payload_size, record_count, correlation_id,
         received_at, retention_until
       ) VALUES ($1, $2, $3, 'JSON', 'application/json', 'worker-integration-1',
         $4, $5, $6, $7, $8, $9, 1, $10, now(), now() + interval '30 days')`,
      [
        rawEventId,
        organizationId,
        connectorId,
        'd'.repeat(64),
        'e'.repeat(64),
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        Buffer.byteLength(text),
        correlationId,
      ],
    );
    await admin.query(
      `INSERT INTO outbox_events (
         organization_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
       ) VALUES ($1, 'raw_event', $2, 'raw_event.received.v1',
         jsonb_build_object('organizationId', $1::uuid::text, 'connectorId', $3::uuid::text,
                            'rawEventId', $2::uuid::text, 'correlationId', $4::text), now())`,
      [organizationId, rawEventId, connectorId, correlationId],
    );
    await admin.query(
      `INSERT INTO detection_rules (
         id, organization_id, key, name, enabled, severity, threshold,
         window_seconds, deduplication_window_seconds, condition,
         correlation_dimensions, created_by_user_id, updated_by_user_id, updated_at
       ) VALUES ($1, $2, 'authentication-failed', 'Authentication failures', true, 'HIGH', 1,
         300, 900, '{"eventTypes":["authentication.failed"],"attributes":[]}'::jsonb,
         ARRAY['FINGERPRINT']::correlation_dimension[], $3, $3, now())`,
      [ruleId, organizationId, userId],
    );
    await admin.query(
      `INSERT INTO detection_rule_versions (
         organization_id, rule_id, version, name, description, severity, threshold,
         window_seconds, deduplication_window_seconds, condition, correlation_dimensions
       ) VALUES ($1, $2, 1, 'Authentication failures', '', 'HIGH', 1, 300, 900,
         '{"eventTypes":["authentication.failed"],"attributes":[]}'::jsonb,
         ARRAY['FINGERPRINT']::correlation_dimension[])`,
      [organizationId, ruleId],
    );

    const pool = createDatabasePool(databaseUrl);
    const connection = redisConnectionFromUrl(
      `redis://${reachableHost(redisContainer)}:${redisContainer.getMappedPort(6379)}`,
    );
    const queue = new Queue<IngestionJob>('aegisflow-ingestion', { connection });
    const detectionQueue = new Queue<DetectionJob>('aegisflow-detection', { connection });
    await queue.obliterate({ force: true });
    await detectionQueue.obliterate({ force: true });
    const logger = pino({ level: 'silent' });
    const processor = new EventIngestionProcessor(
      pool,
      new PayloadCrypto(encryptionKey.toString('base64')),
      'worker-test-pepper-with-at-least-thirty-two-characters',
      logger,
    );
    const worker = new Worker<IngestionJob>(
      'aegisflow-ingestion',
      (job) => processor.process(job.data),
      { connection, concurrency: 1 },
    );
    const detectionProcessor = new DetectionProcessor(pool, logger);
    const detectionWorker = new Worker<DetectionJob>(
      'aegisflow-detection',
      (job) => detectionProcessor.process(job.data),
      { connection, concurrency: 1 },
    );
    let detectionFailure: Error | undefined;
    detectionWorker.on('failed', (_job, error) => {
      detectionFailure = error;
    });
    const dispatcher = new OutboxDispatcher(pool, queue, logger, detectionQueue);
    try {
      await dispatcher.poll();
      await waitFor(async () => {
        const result = await admin.query<{ status: string }>(
          'SELECT status FROM raw_events WHERE id = $1',
          [rawEventId],
        );
        return result.rows[0]?.status === 'NORMALIZED';
      });

      const normalized = await admin.query<{
        actor_user_hash: string;
        attributes: Record<string, unknown>;
        message: string;
        source_ip_hash: string;
      }>('SELECT actor_user_hash, attributes, message, source_ip_hash FROM normalized_events');
      expect(normalized.rowCount).toBe(1);
      const event = normalized.rows[0];
      expect(event?.attributes['authorization']).toBe('[REDACTED]');
      expect(event?.attributes['email']).toMatch(/^user:[a-f0-9]{16}$/u);
      expect(event?.attributes['sourceIp']).toMatch(/^ip:[a-f0-9]{16}$/u);
      expect(event?.message).not.toContain('private@example.test');
      expect(event?.message).not.toContain('203.0.113.42');
      expect(event?.actor_user_hash).toMatch(/^[a-f0-9]{64}$/u);
      expect(event?.source_ip_hash).toMatch(/^[a-f0-9]{64}$/u);

      await expect(
        processor.process({ connectorId, correlationId, organizationId, rawEventId }),
      ).resolves.toMatchObject({ status: 'NORMALIZED' });
      const count = await admin.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM normalized_events',
      );
      expect(count.rows[0]?.count).toBe('1');

      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE aegisflow_app');
      await admin.query(
        `SELECT set_config('app.current_organization_id', $1, true),
                set_config('app.current_user_id', '', true)`,
        [otherOrganizationId],
      );
      const isolated = await admin.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM normalized_events',
      );
      await admin.query('ROLLBACK');
      expect(isolated.rows[0]?.count).toBe('0');

      const outbox = await admin.query<{ status: string }>(
        `SELECT status FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'raw_event.received.v1'`,
        [rawEventId],
      );
      expect(outbox.rows[0]?.status).toBe('PUBLISHED');

      // PostgreSQL retains microseconds while JavaScript Date only retains milliseconds.
      // This proves the detection window uses the authoritative database timestamp.
      await admin.query(
        `UPDATE normalized_events
         SET occurred_at = date_trunc('milliseconds', occurred_at) + interval '0.999 milliseconds'
         WHERE organization_id = $1 AND raw_event_id = $2`,
        [organizationId, rawEventId],
      );

      await dispatcher.poll();
      await waitFor(async () => {
        if (detectionFailure !== undefined) throw detectionFailure;
        const result = await admin.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM alerts WHERE organization_id = $1',
          [organizationId],
        );
        return result.rows[0]?.count === '1';
      });
      const detection = await admin.query<{
        alert_count: string;
        anomaly_count: string;
        execution_count: string;
        risk_score: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM alerts WHERE organization_id = $1) AS alert_count,
           (SELECT count(*)::text FROM anomaly_scores WHERE organization_id = $1) AS anomaly_count,
           (SELECT count(*)::text FROM rule_executions WHERE organization_id = $1) AS execution_count,
           (SELECT risk_score::text FROM alerts WHERE organization_id = $1 LIMIT 1) AS risk_score`,
        [organizationId],
      );
      expect(detection.rows[0]).toMatchObject({
        alert_count: '1',
        anomaly_count: '1',
        execution_count: '1',
      });
      expect(Number(detection.rows[0]?.risk_score)).toBeGreaterThanOrEqual(75);

      await detectionProcessor.process({ organizationId, rawEventId });
      const idempotent = await admin.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM rule_executions WHERE organization_id = $1',
        [organizationId],
      );
      expect(idempotent.rows[0]?.count).toBe('1');

      await admin.query('BEGIN');
      await admin.query('SET LOCAL ROLE aegisflow_app');
      await admin.query(`SELECT set_config('app.current_organization_id', $1, true)`, [
        otherOrganizationId,
      ]);
      const hiddenAlerts = await admin.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM alerts',
      );
      await admin.query('ROLLBACK');
      expect(hiddenAlerts.rows[0]?.count).toBe('0');
    } finally {
      await dispatcher.close();
      await worker.close();
      await detectionWorker.close();
      await queue.close();
      await detectionQueue.close();
      await pool.end();
      await admin.end();
    }
  });
});

function encrypt(text: string, key: Buffer): { authTag: string; ciphertext: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return {
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
  };
}

function reachableHost(container: StartedTestContainer): string {
  return container.getHost() === 'localhost' ? '127.0.0.1' : container.getHost();
}

async function applyMigrations(databaseUrl: string): Promise<void> {
  const migrationsDirectory = resolve(process.cwd(), '..', '..', 'prisma', 'migrations');
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => /^\d/u.test(name))
    .sort();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const migrationName of migrationNames) {
      const sql = await readFile(
        resolve(migrationsDirectory, migrationName, 'migration.sql'),
        'utf8',
      );
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for normalized event');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
