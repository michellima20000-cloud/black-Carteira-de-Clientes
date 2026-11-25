import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { parseInput } from '../../shared/http/validation';
import type { QueueManager } from '../../shared/queues/queue-manager';
import { QUEUE_NAMES } from '../../shared/queues/queue-names';
import { reactivationOptionsSchema } from './template.schemas';

export interface ReactivationRoutesOptions {
  database: DatabaseClient;
  queueManager?: QueueManager | undefined;
}

export function registerReactivationRoutes(
  app: FastifyInstance,
  options: ReactivationRoutesOptions,
): void {
  app.post(
    '/reactivations/preview',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const input = parseInput(reactivationOptionsSchema, request.body);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const result = await store.previewReactivation(input);
      return { data: result };
    },
  );

  app.post(
    '/reactivations/dispatch',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const input = parseInput(reactivationOptionsSchema, request.body);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const result = await store.dispatchReactivation(input, request.authContext!.userId);

      if (options.queueManager && result.messages.length > 0) {
        for (const msg of result.messages) {
          await options.queueManager.enqueue(QUEUE_NAMES.outgoingMessages, 'send-reactivation', {
            accountId: request.authContext!.accountId,
            conversationId: msg.conversationId,
            messageId: msg.messageId,
            toPhone: msg.toPhone,
            body: msg.body,
          });
        }
      }

      return reply.code(200).send({
        data: {
          templateId: result.templateId,
          dispatchedCount: result.dispatchedCount,
          skippedBlocklistCount: result.skippedBlocklistCount,
        },
      });
    },
  );
}
