import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import {
  createQuickReplySchema,
  quickReplyIdParamsSchema,
  updateQuickReplySchema,
} from './whatsapp.schemas';

export interface QuickReplyRoutesOptions {
  database: DatabaseClient;
}

export function registerQuickReplyRoutes(
  app: FastifyInstance,
  options: QuickReplyRoutesOptions,
): void {
  app.get('/quick-replies', { preHandler: app.authenticate }, async (request) => {
    const store = new TenantStore(options.database, request.authContext!.accountId);
    return { data: await store.listQuickReplies() };
  });

  app.post('/quick-replies', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseInput(createQuickReplySchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const created = await store.createQuickReply(input, request.authContext!.userId);
    return reply.code(201).send({ data: created });
  });

  app.patch('/quick-replies/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(quickReplyIdParamsSchema, request.params);
    const input = parseInput(updateQuickReplySchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const updated = await store.updateQuickReply(id, input, request.authContext!.userId);
    if (!updated) throw new NotFoundError('Resposta rápida não encontrada.');
    return { data: updated };
  });

  app.delete(
    '/quick-replies/:id',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const { id } = parseInput(quickReplyIdParamsSchema, request.params);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const deleted = await store.deleteQuickReply(id, request.authContext!.userId);
      if (!deleted) throw new NotFoundError('Resposta rápida não encontrada.');
      return reply.code(204).send();
    },
  );
}
