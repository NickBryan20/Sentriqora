import type { ConnectionOptions } from 'bullmq';

export function redisConnectionFromUrl(rawUrl: string): ConnectionOptions {
  const url = new URL(rawUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }

  const password = url.password === '' ? undefined : decodeURIComponent(url.password);
  const username = url.username === '' ? undefined : decodeURIComponent(url.username);

  return {
    db: url.pathname.length > 1 ? Number.parseInt(url.pathname.slice(1), 10) : 0,
    host: url.hostname,
    maxRetriesPerRequest: null,
    password,
    port: url.port === '' ? (url.protocol === 'rediss:' ? 6380 : 6379) : Number(url.port),
    tls: url.protocol === 'rediss:' ? {} : undefined,
    username,
  };
}
