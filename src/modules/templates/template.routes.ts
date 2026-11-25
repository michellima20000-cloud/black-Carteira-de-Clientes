import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import {
  createTemplateSchema,
  listTemplatesQuerySchema,
  templateIdParamsSchema,
  updateTemplateSchema,
} from './template.schemas';

export interface TemplateRoutesOptions {
  database: DatabaseClient;
}

export function registerTemplateRoutes(app: FastifyInstance, options: TemplateRoutesOptions): void {
  app.get('/templates', { preHandler: app.authenticate }, async (request) => {
    const query = parseInput(listTemplatesQuerySchema, request.query);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const result = await store.listMessageTemplates(query);

    return {
      data: result.items,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      },
    };
  });

  app.get('/templates/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(templateIdParamsSchema, request.params);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const template = await store.findMessageTemplate(id);
    if (!template) throw new NotFoundError('Template de mensagem não encontrado.');
    return { data: template };
  });

  app.post(
    '/templates',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const input = parseInput(createTemplateSchema, request.body);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const created = await store.createMessageTemplate(input, request.authContext!.userId);
      return reply.code(201).send({ data: created });
    },
  );

  app.patch(
    '/templates/:id',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const { id } = parseInput(templateIdParamsSchema, request.params);
      const input = parseInput(updateTemplateSchema, request.body);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const updated = await store.updateMessageTemplate(id, input, request.authContext!.userId);
      if (!updated) throw new NotFoundError('Template de mensagem não encontrado.');
      return { data: updated };
    },
  );

  app.delete(
    '/templates/:id',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const { id } = parseInput(templateIdParamsSchema, request.params);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const deleted = await store.deleteMessageTemplate(id, request.authContext!.userId);
      if (!deleted) throw new NotFoundError('Template de mensagem não encontrado.');
      return reply.code(204).send();
    },
  );
}
