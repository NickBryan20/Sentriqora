import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ComponentHealth } from '@aegisflow/contracts';
import { Socket } from 'node:net';

import type { Environment } from '../../configuration';
import type { DependencyHealthPort } from '../application/ports/dependency-health.port';

interface DependencyTarget {
  name: string;
  url: string;
}

@Injectable()
export class TcpDependencyHealthAdapter implements DependencyHealthPort {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>) {}

  async check(): Promise<ComponentHealth[]> {
    const targets: DependencyTarget[] = [
      { name: 'postgresql', url: this.config.get('DATABASE_URL', { infer: true }) },
      { name: 'redis', url: this.config.get('REDIS_URL', { infer: true }) },
      { name: 'minio', url: this.config.get('MINIO_ENDPOINT', { infer: true }) },
    ];

    return Promise.all(targets.map((target) => this.probe(target)));
  }

  private async probe(target: DependencyTarget): Promise<ComponentHealth> {
    const startedAt = performance.now();

    try {
      await this.connect(target.url);
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        name: target.name,
        status: 'up',
      };
    } catch {
      return {
        latencyMs: Math.round(performance.now() - startedAt),
        name: target.name,
        status: 'down',
      };
    }
  }

  private connect(rawUrl: string): Promise<void> {
    const target = new URL(rawUrl);
    const port = this.resolvePort(target);

    return new Promise((resolve, reject) => {
      const socket = new Socket();

      const finish = (error?: Error): void => {
        socket.removeAllListeners();
        socket.destroy();
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };

      socket.setTimeout(1_500);
      socket.once('connect', () => finish());
      socket.once('error', (error) => finish(error));
      socket.once('timeout', () => finish(new Error('Dependency connection timed out')));
      socket.connect(port, target.hostname);
    });
  }

  private resolvePort(target: URL): number {
    if (target.port !== '') {
      return Number.parseInt(target.port, 10);
    }

    const defaults: Record<string, number> = {
      'http:': 80,
      'https:': 443,
      'postgres:': 5432,
      'postgresql:': 5432,
      'redis:': 6379,
      'rediss:': 6380,
    };
    const port = defaults[target.protocol];
    if (port === undefined) {
      throw new Error(`Unsupported dependency protocol: ${target.protocol}`);
    }

    return port;
  }
}
