import Redis from 'ioredis';

export function createApiRedis(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
    lazyConnect: true,
  });
  // Silencia ECONNREFUSED e erros de rede para não crashar o processo
  client.on('error', () => {
    // Redis indisponível – ignorado; health check reportará "down"
  });
  client.connect().catch(() => {
    // Falha na conexão inicial – não é fatal para a API HTTP
  });
  return client;
}

export function createBullRedis(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.on('error', () => {
    // BullMQ Redis indisponível – filas ficam desativadas
  });
  client.connect().catch(() => {
    // Falha silenciosa; sem Redis, as filas simplesmente não processam
  });
  return client;
}
