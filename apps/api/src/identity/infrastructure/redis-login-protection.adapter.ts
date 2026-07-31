import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';

import type { Environment } from '../../configuration';
import { ApplicationError } from '../application/application-error';
import type { LoginProtectionPort } from '../application/ports/login-protection.port';

const WINDOW_SECONDS = 15 * 60;
const IDENTITY_LIMIT = 10;
const IP_LIMIT = 30;

@Injectable()
export class RedisLoginProtectionAdapter implements LoginProtectionPort, OnModuleDestroy {
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

  async assertAllowed(ipAddress: string, normalizedEmail: string): Promise<void> {
    try {
      await this.ensureConnected();
      const [ipAttempts, identityAttempts] = await this.redis.mget(
        this.ipKey(ipAddress),
        this.identityKey(normalizedEmail),
      );
      if (Number(ipAttempts ?? 0) >= IP_LIMIT || Number(identityAttempts ?? 0) >= IDENTITY_LIMIT) {
        throw new ApplicationError('rate_limited', 'Too many authentication attempts.', 429);
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(
        'service_unavailable',
        'Authentication protection is temporarily unavailable.',
        503,
      );
    }
  }

  async recordFailure(ipAddress: string, normalizedEmail: string): Promise<void> {
    try {
      await this.ensureConnected();
      const transaction = this.redis.multi();
      for (const key of [this.ipKey(ipAddress), this.identityKey(normalizedEmail)]) {
        transaction.incr(key);
        transaction.expire(key, WINDOW_SECONDS, 'NX');
      }
      await transaction.exec();
    } catch {
      throw new ApplicationError(
        'service_unavailable',
        'Authentication protection is temporarily unavailable.',
        503,
      );
    }
  }

  async resetIdentity(normalizedEmail: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.redis.del(this.identityKey(normalizedEmail));
    } catch {
      throw new ApplicationError(
        'service_unavailable',
        'Authentication protection is temporarily unavailable.',
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

  private identityKey(value: string): string {
    return `auth:identity:${digest(value)}`;
  }

  private ipKey(value: string): string {
    return `auth:ip:${digest(value)}`;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
