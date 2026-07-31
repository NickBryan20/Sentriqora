import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Environment, validateEnvironment } from '../src/configuration';
import { PrismaIdentityRepository } from '../src/identity/infrastructure/prisma/prisma-identity.repository';
import { PrismaService } from '../src/identity/infrastructure/prisma/prisma.service';
import { TenantPrismaExecutor } from '../src/identity/infrastructure/prisma/tenant-prisma.executor';

const { Client } = pg;

describe('PostgreSQL tenant isolation', () => {
  let container: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let executor: TenantPrismaExecutor;
  let repository: PrismaIdentityRepository;

  beforeAll(async () => {
    container = await new GenericContainer('pgvector/pgvector:0.8.1-pg17-bookworm')
      .withEnvironment({
        POSTGRES_DB: 'aegisflow_test',
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

    const databaseUrl = `postgresql://postgres:test-only-password@${reachableHost(container)}:${container.getMappedPort(5432)}/aegisflow_test`;
    await applyMigrations(databaseUrl);
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: process.env.INTEGRATION_LOG_LEVEL ?? 'silent',
      NODE_ENV: 'test',
      REDIS_URL: `redis://${reachableHost(redisContainer)}:${redisContainer.getMappedPort(6379)}`,
    });
    const environment = validateEnvironment({ DATABASE_URL: databaseUrl, NODE_ENV: 'test' });
    prisma = new PrismaService(new ConfigService<Environment, true>(environment));
    executor = new TenantPrismaExecutor(prisma);
    repository = new PrismaIdentityRepository(executor);
    const [{ AppModule }, { configureApplication }] = await Promise.all([
      import('../src/app.module.js'),
      import('../src/bootstrap.js'),
    ]);
    const moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await redisContainer?.stop();
    await container?.stop();
  });

  it('prevents reading and modifying another organization even without a Prisma tenant filter', async () => {
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const audit = { correlationId: randomUUID(), ipHash: 'a'.repeat(64) };

    const registrationA = await repository.register({
      audit,
      displayName: 'Tenant A Owner',
      email: 'owner-a@example.test',
      normalizedEmail: 'owner-a@example.test',
      organizationId: organizationA,
      organizationName: 'Tenant A',
      organizationSlug: `tenant-a-${organizationA.slice(0, 8)}`,
      passwordHash: 'test-argon-hash-a',
      userId: userA,
    });
    const registrationB = await repository.register({
      audit,
      displayName: 'Tenant B Owner',
      email: 'owner-b@example.test',
      normalizedEmail: 'owner-b@example.test',
      organizationId: organizationB,
      organizationName: 'Tenant B',
      organizationSlug: `tenant-b-${organizationB.slice(0, 8)}`,
      passwordHash: 'test-argon-hash-b',
      userId: userB,
    });
    expect('identity' in registrationA).toBe(true);
    expect('identity' in registrationB).toBe(true);

    const visibleOrganizations = await executor.run(
      { organizationId: organizationA, userId: userA },
      (transaction) =>
        transaction.membership.findMany({
          select: { organizationId: true },
        }),
    );
    expect(visibleOrganizations).toEqual([{ organizationId: organizationA }]);

    const crossTenantUpdate = await executor.run(
      { organizationId: organizationA, userId: userA },
      (transaction) =>
        transaction.role.updateMany({
          data: { name: 'Cross-tenant overwrite' },
          where: { organizationId: organizationB },
        }),
    );
    expect(crossTenantUpdate.count).toBe(0);

    await expect(
      repository.findLoginIdentity('owner-b@example.test', organizationA),
    ).resolves.toBeNull();
    const tenantBMembers = await repository.listMembers(organizationB, userB);
    expect(tenantBMembers.map((member) => member.email)).toEqual(['owner-b@example.test']);
  });

  it('keeps security event records append-only for the application role', async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    await repository.register({
      audit: { correlationId: randomUUID() },
      displayName: 'Audit Owner',
      email: 'audit-owner@example.test',
      normalizedEmail: 'audit-owner@example.test',
      organizationId,
      organizationName: 'Audit Tenant',
      organizationSlug: `audit-${organizationId.slice(0, 8)}`,
      passwordHash: 'test-argon-hash',
      userId,
    });

    await expect(
      executor.run({ organizationId, userId }, (transaction) =>
        transaction.eventRecord.updateMany({ data: { outcome: 'tampered' } }),
      ),
    ).rejects.toThrow();
  });

  it('executes registration, MFA login, CSRF and tenant guards through HTTP', async () => {
    const agent = request.agent(app.getHttpServer());
    const password = 'Correct-Horse-Battery-2026!';
    const registration = await agent
      .post('/api/v1/auth/register')
      .send({
        displayName: 'HTTP Owner',
        email: `http-${randomUUID()}@example.test`,
        isAdmin: true,
        organizationName: 'HTTP Tenant',
        password,
      })
      .expect(400);
    expect(registration.body).toMatchObject({ status: 400 });

    const email = `http-${randomUUID()}@example.test`;
    const registered = await agent
      .post('/api/v1/auth/register')
      .send({
        displayName: 'HTTP Owner',
        email,
        organizationName: 'HTTP Tenant',
        organizationSlug: `http-${randomUUID().slice(0, 8)}`,
        password,
      })
      .expect(201);
    const organizationId = readStringProperty(registered.body, 'organizationId');

    const otherOrganizationId = randomUUID();
    const otherUserId = randomUUID();
    const otherEmail = `other-${randomUUID()}@example.test`;
    await repository.register({
      audit: { correlationId: randomUUID() },
      displayName: 'Other Owner',
      email: otherEmail,
      normalizedEmail: otherEmail,
      organizationId: otherOrganizationId,
      organizationName: 'Other Tenant',
      organizationSlug: `other-${randomUUID().slice(0, 8)}`,
      passwordHash: 'test-hash',
      userId: otherUserId,
    });

    const loggedIn = await agent
      .post('/api/v1/auth/login')
      .send({ deviceName: 'Vitest browser', email, organizationId, password })
      .expect(200);
    expect(loggedIn.body).toMatchObject({ mfaRequired: false });
    let csrfToken = extractCookie(loggedIn.headers['set-cookie'], 'aegisflow_csrf');

    await agent.post('/api/v1/auth/mfa/enrollment').expect(403);
    const enrollment = await agent
      .post('/api/v1/auth/mfa/enrollment')
      .set('x-csrf-token', csrfToken)
      .expect(200);
    const secret = readStringProperty(enrollment.body, 'secret');
    const currentCode = createTotp(secret, Date.now());
    const recovery = await agent
      .post('/api/v1/auth/mfa/enrollment/confirm')
      .set('x-csrf-token', csrfToken)
      .send({ code: currentCode })
      .expect(200);
    expect(readArrayProperty(recovery.body, 'recoveryCodes')).toHaveLength(10);

    const challengeResponse = await agent
      .post('/api/v1/auth/login')
      .send({ deviceName: 'Vitest MFA browser', email, organizationId, password })
      .expect(200);
    expect(challengeResponse.body).toMatchObject({ mfaRequired: true });
    const challengeId = readStringProperty(challengeResponse.body, 'challengeId');
    const verified = await agent
      .post('/api/v1/auth/mfa/verify')
      .send({
        challengeId,
        code: createTotp(secret, Date.now() + 30_000),
        deviceName: 'Vitest MFA browser',
        organizationId,
      })
      .expect(200);
    csrfToken = extractCookie(verified.headers['set-cookie'], 'aegisflow_csrf');

    await agent.get(`/api/v1/organizations/${organizationId}/members`).expect(200);
    await agent.get(`/api/v1/organizations/${otherOrganizationId}/members`).expect(403);
    const sessions = await agent.get('/api/v1/auth/sessions').expect(200);
    expect(Array.isArray(sessions.body)).toBe(true);
    await agent.post('/api/v1/auth/logout-all').set('x-csrf-token', csrfToken).expect(200);
    await agent.get('/api/v1/auth/me').expect(401);
  });
});

function reachableHost(startedContainer: StartedTestContainer): string {
  const host = startedContainer.getHost();
  return host === 'localhost' ? '127.0.0.1' : host;
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

function extractCookie(header: string | string[] | undefined, name: string): string {
  const values = Array.isArray(header) ? header : header === undefined ? [] : [header];
  for (const value of values) {
    const match = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`, 'u').exec(value);
    if (match?.[1] !== undefined) {
      return decodeURIComponent(match[1]);
    }
  }
  throw new Error(`Cookie ${name} was not returned`);
}

function readStringProperty(value: unknown, property: string): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(property in value) ||
    typeof (value as Record<string, unknown>)[property] !== 'string'
  ) {
    throw new Error(`Response property ${property} is missing`);
  }
  return (value as Record<string, string>)[property] ?? '';
}

function readArrayProperty(value: unknown, property: string): readonly unknown[] {
  if (typeof value !== 'object' || value === null || !(property in value)) {
    throw new Error(`Response property ${property} is missing`);
  }
  const candidate = (value as Record<string, unknown>)[property];
  if (!Array.isArray(candidate)) {
    throw new Error(`Response property ${property} is not an array`);
  }
  return candidate;
}

function createTotp(secret: string, timestamp: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error('Invalid TOTP secret');
    }
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 15;
  return ((digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000).toString().padStart(6, '0');
}
