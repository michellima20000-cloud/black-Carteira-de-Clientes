import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/shared/config/env';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
};

describe('loadConfig', () => {
  it('normaliza as origens CORS', () => {
    const config = loadConfig({
      ...validEnvironment,
      CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
    });

    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('recusa segredos JWT curtos', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'curto',
      }),
    ).toThrow();
  });
});
