import { loadConfig } from '../shared/config/env';
import { createDatabaseClient } from '../shared/db/prisma';
import { createBullRedis } from '../shared/queues/redis';
import { createWorkerRuntime } from './runtime';

async function startWorker(): Promise<void> {
  const config = loadConfig();
  const redis = createBullRedis(config.redisUrl);
  const database = createDatabaseClient(config.databaseUrl);

  redis.on('error', (error: Error) => {
    console.error({ err: error }, 'Erro de conexão do worker com Redis');
  });

  await redis.ping();
  await database.$queryRaw`SELECT 1`;

  const runtime = createWorkerRuntime({
    connection: redis,
    database,
    concurrency: 5,
  });

  const heartbeat = setInterval(() => {
    console.info({ worker: 'heartbeat', timestamp: new Date().toISOString() }, 'Worker ativo');
  }, 30_000);
  heartbeat.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(heartbeat);
    console.info({ signal }, 'Encerrando worker sem perder jobs em andamento');
    await runtime.close();
    await database.$disconnect();
    await redis.quit().catch(() => redis.disconnect());
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  console.info('Worker iniciado com filas BullMQ e dead-letter.');
}

startWorker().catch((error: unknown) => {
  console.error('Não foi possível iniciar o worker.', error);
  process.exit(1);
});
