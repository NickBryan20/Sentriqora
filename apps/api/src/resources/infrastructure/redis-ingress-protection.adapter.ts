import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';

import type { Environment } from '../../configuration';
import { ApplicationError } from '../../identity/application/application-error';
import type { IngressProtectionPort } from '../application/ports/ingress-protection.port';

const WINDOW_SECONDS = 60;
const CONNECTOR_LIMIT = 120;
const CREDENTIAL_LIMIT = 60;
const FIXED_WINDOW_SCRIPT = `
local connector = redis.call('INCR', KEYS[1])
if connector == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local credential = redis.call('INCR', KEYS[2])
if credential == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
return { connector, credential}
`;

@Injectable()
export class RedisIngressProtectionAdapter implements IngressProtectionPort, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      commandTimeout: 2_000,
      connectTimeout: 2_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async assertAllowed(input: {
    connectorId: string;
    credential: string;
    ipAddress: string;
    organizationId: string;
  }): Promise<void> {
    try {
      await this.ensureConnected();
      const connectorKey = `ingress:connector:${digest(`${input.organizationId}:${input.connectorId}`)}`;
      const credentialKey = `ingress:credential:${digest(
        `${input.organizationId}:${input.connectorId}:${input.credential}:${input.ipAddress}`,
      )}`;
      const result = (await this.redis.eval(
        FIXED_WINDOW_SCRIPT,
        2,
        connectorKey,
        credentialKey,
        WINDOW_SECONDS,
      )) as [number, number];
      if (Number(result[0]) > CONNECTOR_LIMIT || Number(result[1]) > CREDENTIAL_LIMIT) {
        throw new ApplicationError('rate_limited', 'Too many connector requests.', 429);
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(
        'service_unavailable',
        'Connector request protection is temporarily unavailable.',
        503,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
      return;
    }
    this.redis.disconnect();
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') {
      await this.redis.connect();
    }
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
