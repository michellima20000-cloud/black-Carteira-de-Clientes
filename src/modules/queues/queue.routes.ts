import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import type { QueueManager } from '../../shared/queues/queue-manager';
import { QUEUE_NAMES } from '../../shared/queues/queue-names';

export interface QueueRoutesOptions {
  queueManager: QueueManager;
}

const deadLetterParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const listDeadLettersQuerySchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  end: z.coerce.number().int().min(0).max(200).default(49),
});

const inactiveScanBodySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(30),
});

export function registerQueueRoutes(app: FastifyInstance, options: QueueRoutesOptions): void {
  app.get(
    '/queues/metrics',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async () => {
      const metrics = await options.queueManager.getMetrics();
      return { data: metrics };
    },
  );

  app.get(
    '/queues/dead-letters',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const query = parseInput(listDeadLettersQuerySchema, request.query);
      const entries = await options.queueManager.listDeadLetters(
        request.authContext!.accountId,
        query.start,
        query.end,
      );
      return { data: entries };
    },
  );

  app.post(
    '/queues/dead-letters/:id/requeue',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const { id } = parseInput(deadLetterParamsSchema, request.params);
      const result = await options.queueManager.requeueDeadLetter(
        id,
        request.authContext!.accountId,
      );
      if (!result) throw new NotFoundError('Job na fila de dead-letter não encontrado.');
      return { data: result };
    },
  );

  app.post(
    '/queues/inactive-scan',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const input = parseInput(inactiveScanBodySchema, request.body ?? {});
      const { jobId } = await options.queueManager.enqueue(
        QUEUE_NAMES.inactiveScan,
        'manual-inactive-scan',
        {
          accountId: request.authContext!.accountId,
          days: input.days,
          actorUserId: request.authContext!.userId,
        },
      );
      return reply.code(202).send({ data: { jobId } });
    },
  );
}
