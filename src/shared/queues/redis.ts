import Redis from 'ioredis';

export function createApiRedis(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });
}

export function createBullRedis(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
