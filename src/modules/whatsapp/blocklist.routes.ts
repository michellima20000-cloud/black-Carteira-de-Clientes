import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import { blocklistIdParamsSchema, createBlocklistEntrySchema } from './whatsapp.schemas';

export interface BlocklistRoutesOptions {
  database: DatabaseClient;
}

export function registerBlocklistRoutes(app: FastifyInstance, options: BlocklistRoutesOptions): void {
  app.get(
    '/blocklist',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const store = new TenantStore(options.database, request.authContext!.accountId);
      return { data: await store.listBlocklist() };
    },
  );

  app.post(
    '/blocklist',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const input = parseInput(createBlocklistEntrySchema, request.body);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const created = await store.addBlocklistEntry(
        input.phone,
        input.reason,
        request.authContext!.userId,
      );
      return reply.code(201).send({ data: created });
    },
  );

  app.delete(
    '/blocklist/:id',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const { id } = parseInput(blocklistIdParamsSchema, request.params);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const deleted = await store.removeBlocklistEntry(id, request.authContext!.userId);
      if (!deleted) throw new NotFoundError('Registro na blocklist não encontrado.');
      return reply.code(204).send();
    },
  );
}
