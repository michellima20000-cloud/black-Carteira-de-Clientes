import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app';
import type { AppConfig } from '../../src/shared/config/env';
import type { DatabaseClient } from '../../src/shared/db/prisma';

/**
 * Garante que rotas chamadas via POST sem payload (ex.: iniciar o QR Code do
 * WhatsApp) funcionem mesmo quando o cliente envia `Content-Type:
 * application/json` sem corpo — antes isso respondia 415 e quebrava o fluxo.
 */
function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    databaseUrl: 'postgresql://localhost:5432/teste',
    redisUrl: 'redis://localhost:6379',
    jwt: {
      accessSecret: 'access-secret-for-tests-with-at-least-32-characters',
      refreshSecret: 'refresh-secret-for-tests-with-at-least-32-characters',
      issuer: 'black-carteira-test',
      audience: 'black-carteira-panel-test',
      accessTtlSeconds: 900,
      refreshTtlDays: 7,
    },
    encryptionKey: 'encryption-key-for-tests-with-at-least-16-characters',
    corsOrigins: ['http://localhost:5173'],
    cookie: {
      name: 'refresh_token',
      secure: false,
      sameSite: 'lax',
      domain: undefined,
    },
    rateLimit: { max: 1_000, timeWindow: '1 minute' },
    loginRateLimit: { max: 100, timeWindow: '1 minute' },
    apiBaseUrl: 'http://localhost:3000',
  };
}

const database = {
  $executeRawUnsafe: () => Promise.resolve(0),
  $queryRawUnsafe: () => Promise.resolve([]),
  user: { findUnique: () => Promise.resolve(null) },
} as unknown as DatabaseClient;

const redis = { ping: () => Promise.resolve('PONG') };

describe('parser de JSON tolerante a body vazio', () => {
  it('aceita POST sem body mesmo com Content-Type application/json', async () => {
    const app = await buildApp({ config: testConfig(), database, redis, logger: false });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: '',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    } finally {
      await app.close();
    }
  });

  it('continua aceitando JSON válido', async () => {
    const app = await buildApp({ config: testConfig(), database, redis, logger: false });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'teste@example.com', password: 'Senha-Forte-123!' },
      });

      // Credenciais inexistentes => 401 (o corpo foi lido corretamente).
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('não responde 415 quando o content-type não é suportado', async () => {
    const app = await buildApp({ config: testConfig(), database, redis, logger: false });
    await app.ready();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'email=teste@example.com',
      });

      expect(response.statusCode).not.toBe(415);
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
