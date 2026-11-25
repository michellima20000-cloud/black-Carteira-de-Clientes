import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';

export interface AccountRoutesOptions {
  database: DatabaseClient;
}

export function registerAccountRoutes(app: FastifyInstance, options: AccountRoutesOptions): void {
  app.get('/accounts/users', { preHandler: app.authenticate }, async (request) => {
    const store = new TenantStore(options.database, request.authContext!.accountId);
    return { data: await store.listUsers() };
  });
}
