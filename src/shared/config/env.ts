import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32).default('black-carteira-default-jwt-access-secret-32-chars-min'),
  JWT_REFRESH_SECRET: z.string().min(32).default('black-carteira-default-jwt-refresh-secret-32-chars-min'),
  JWT_ISSUER: z.string().min(1).default('black-carteira-api'),
  JWT_AUDIENCE: z.string().min(1).default('black-carteira-painel'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_NAME: z.string().min(1).default('refresh_token'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),
});

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  databaseUrl: string;
  redisUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlDays: number;
  };
  corsOrigins: string[];
  cookie: {
    name: string;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain: string | undefined;
  };
  rateLimit: {
    max: number;
    timeWindow: string;
  };
  loginRateLimit: {
    max: number;
    timeWindow: string;
  };
  apiBaseUrl: string;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    jwt: {
      accessSecret: parsed.JWT_ACCESS_SECRET,
      refreshSecret: parsed.JWT_REFRESH_SECRET,
      issuer: parsed.JWT_ISSUER,
      audience: parsed.JWT_AUDIENCE,
      accessTtlSeconds: parsed.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDays: parsed.REFRESH_TOKEN_TTL_DAYS,
    },
    corsOrigins: parsed.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookie: {
      name: parsed.COOKIE_NAME,
      secure: parsed.COOKIE_SECURE
        ? parsed.COOKIE_SECURE === 'true'
        : parsed.NODE_ENV === 'production',
      sameSite: parsed.COOKIE_SAME_SITE,
      domain: parsed.COOKIE_DOMAIN || undefined,
    },
    rateLimit: {
      max: parsed.RATE_LIMIT_MAX,
      timeWindow: parsed.RATE_LIMIT_WINDOW,
    },
    loginRateLimit: {
      max: parsed.LOGIN_RATE_LIMIT_MAX,
      timeWindow: parsed.LOGIN_RATE_LIMIT_WINDOW,
    },
    apiBaseUrl: parsed.API_BASE_URL,
  };
}
