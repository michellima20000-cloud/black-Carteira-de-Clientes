import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerAccountRoutes } from '../modules/accounts/account.routes';
import { registerAuthRoutes } from '../modules/auth/auth.routes';
import { TokenService } from '../modules/auth/token.service';
import { registerComplianceRoutes } from '../modules/compliance/compliance.routes';
import { registerCustomerRoutes } from '../modules/customers/customer.routes';
import { registerGoalRoutes } from '../modules/goals/goal.routes';
import { registerImportRoutes } from '../modules/imports/import.routes';
import { registerObservabilityRoutes } from '../modules/observability/observability.routes';
import { registerQueueRoutes } from '../modules/queues/queue.routes';
import { registerSaleRoutes } from '../modules/sales/sale.routes';
import { registerReactivationRoutes } from '../modules/templates/reactivation.routes';
import { registerTemplateRoutes } from '../modules/templates/template.routes';
import { registerBlocklistRoutes } from '../modules/whatsapp/blocklist.routes';
import { registerConversationRoutes } from '../modules/whatsapp/conversation.routes';
import { registerQuickReplyRoutes } from '../modules/whatsapp/quick-reply.routes';
import { registerWhatsappConfigRoutes } from '../modules/whatsapp/whatsapp-config.routes';
import { registerWhatsappWebhookRoutes } from '../modules/whatsapp/whatsapp-webhook.routes';
import { loadConfig, type AppConfig } from '../shared/config/env';
import { createDatabaseClient, type DatabaseClient } from '../shared/db/prisma';
import { AppError } from '../shared/http/app-error';
import { QueueManager } from '../shared/queues/queue-manager';
import { createApiRedis, createBullRedis } from '../shared/queues/redis';
import { registerAuthPlugin } from './plugins/auth.plugin';
import { registerHealthRoutes, type RedisHealthClient } from './routes/health.routes';

export interface BuildAppOptions {
  config?: AppConfig;
  database?: DatabaseClient;
  redis?: RedisHealthClient;
  queueManager?: QueueManager;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const ownsDatabase = !options.database;
  const database = options.database ?? createDatabaseClient(config.databaseUrl);
  const ownsRedis = !options.redis;
  const isExternalRedis = !config.redisUrl.includes('localhost') && !config.redisUrl.includes('127.0.0.1');
  const redis = options.redis ?? createApiRedis(config.redisUrl);
  // Só cria BullMQ se houver Redis externo configurado; evita loop de reconexão em Render sem Redis
  const ownsQueueManager = !options.queueManager && !options.redis && isExternalRedis;
  const queueRedis = ownsQueueManager ? createBullRedis(config.redisUrl) : undefined;
  const queueManager =
    options.queueManager ?? (queueRedis ? new QueueManager(queueRedis) : undefined);

  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    trustProxy: true,
    requestIdHeader: 'x-request-id',
  });

  const tokens = new TokenService({
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    accessSecret: config.jwt.accessSecret,
    refreshSecret: config.jwt.refreshSecret,
    accessTtlSeconds: config.jwt.accessTtlSeconds,
    refreshTtlDays: config.jwt.refreshTtlDays,
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
        cb(null, true);
        return;
      }
      try {
        const url = new URL(origin);
        if (
          url.hostname.endsWith('.vercel.app') ||
          url.hostname === 'localhost' ||
          url.hostname === '127.0.0.1'
        ) {
          cb(null, true);
          return;
        }
      } catch {
        // Ignora URL inválida
      }
      cb(new Error('Origem não permitida pelo CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
  });

  registerAuthPlugin(app, tokens);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos.',
          details: error.flatten(),
        },
      });
    }

    request.log.error({ err: error }, 'Erro não tratado');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Não foi possível concluir a operação.',
      },
    });
  });

  registerHealthRoutes(app, { database, redis });
  registerAuthRoutes(app, { config, database });
  registerAccountRoutes(app, { database });
  registerCustomerRoutes(app, { database });
  registerSaleRoutes(app, { database });
  registerImportRoutes(app, { database });
  registerGoalRoutes(app, { database });
  registerConversationRoutes(app, { database, queueManager });
  registerQuickReplyRoutes(app, { database });
  registerBlocklistRoutes(app, { database });
  registerWhatsappWebhookRoutes(app, {
    database,
    queueManager,
    encryptionKey: config.encryptionKey,
  });
  registerWhatsappConfigRoutes(app, {
    database,
    apiBaseUrl: config.apiBaseUrl,
    encryptionKey: config.encryptionKey,
  });
  registerTemplateRoutes(app, { database });
  registerReactivationRoutes(app, { database, queueManager });
  registerComplianceRoutes(app, { database });
  registerObservabilityRoutes(app);
  if (queueManager) {
    registerQueueRoutes(app, { queueManager });
  }

  app.addHook('onClose', async () => {
    if (ownsQueueManager && queueManager) {
      await queueManager.close();
    }
    if (queueRedis) {
      await queueRedis.quit().catch(() => queueRedis.disconnect());
    }
    if (ownsRedis) {
      if (redis.quit) {
        await redis.quit().catch(() => redis.disconnect?.());
      } else {
        redis.disconnect?.();
      }
    }
    if (ownsDatabase) {
      await database.$disconnect();
    }
  });

  return app;
}
