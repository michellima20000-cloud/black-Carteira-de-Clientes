import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';

export interface RedisHealthClient {
  ping(): Promise<string>;
  quit?: () => Promise<string>;
  disconnect?: () => void;
}

export interface HealthRoutesOptions {
  database: DatabaseClient;
  redis: RedisHealthClient;
}

async function checkDatabase(database: DatabaseClient): Promise<'up' | 'down'> {
  try {
    await database.$queryRaw`SELECT 1`;
    return 'up';
  } catch {
    return 'down';
  }
}

async function checkRedis(redis: RedisHealthClient): Promise<'up' | 'down'> {
  try {
    const response = await redis.ping();
    return response === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRoutesOptions): void {
  app.get('/health', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      checkDatabase(options.database),
      checkRedis(options.redis),
    ]);
    // A API é considerada saudável enquanto o banco estiver up.
    // Redis offline deixa o serviço "degraded" mas ainda operacional (200).
    const healthy = database === 'up';
    const status = healthy ? (redis === 'up' ? 'ok' : 'degraded') : 'down';

    return reply.code(healthy ? 200 : 503).send({
      status,
      database,
      redis,
      // Commit implantado (Render) — ajuda a conferir qual versão está no ar.
      version: process.env.RENDER_GIT_COMMIT ?? null,
      timestamp: new Date().toISOString(),
    });
  });
}
