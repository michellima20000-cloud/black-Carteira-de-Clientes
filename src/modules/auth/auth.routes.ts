import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../shared/config/env';
import type { DatabaseClient } from '../../shared/db/prisma';
import { parseInput } from '../../shared/http/validation';
import { AuthService } from './auth.service';
import { loginSchema, refreshSchema } from './auth.schemas';
import { TokenService } from './token.service';

export interface AuthRoutesOptions {
  config: AppConfig;
  database: DatabaseClient;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const tokens = new TokenService({
    issuer: options.config.jwt.issuer,
    audience: options.config.jwt.audience,
    accessSecret: options.config.jwt.accessSecret,
    refreshSecret: options.config.jwt.refreshSecret,
    accessTtlSeconds: options.config.jwt.accessTtlSeconds,
    refreshTtlDays: options.config.jwt.refreshTtlDays,
  });
  const service = new AuthService(options.database, tokens, options.config.jwt.accessTtlSeconds);

  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: options.config.loginRateLimit.max,
          timeWindow: options.config.loginRateLimit.timeWindow,
        },
      },
    },
    async (request, reply) => {
      const input = parseInput(loginSchema, request.body);
      const session = await service.login(input.email, input.password);
      return reply.send({ data: session });
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: {
        rateLimit: {
          max: options.config.loginRateLimit.max,
          timeWindow: options.config.loginRateLimit.timeWindow,
        },
      },
    },
    async (request, reply) => {
      const input = parseInput(refreshSchema, request.body);
      const session = await service.refresh(input.refreshToken);
      return reply.send({ data: session });
    },
  );

  app.post('/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseInput(refreshSchema, request.body);
    await service.logout(request.authContext!.accountId, input.refreshToken);
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await service.getCurrentUser(
      request.authContext!.userId,
      request.authContext!.accountId,
    );
    return reply.send({ data: user });
  });
}
