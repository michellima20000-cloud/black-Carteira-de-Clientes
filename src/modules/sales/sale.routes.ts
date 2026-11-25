import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import {
  createSaleSchema,
  listSalesQuerySchema,
  saleIdParamsSchema,
  updateSaleSchema,
} from './sale.schemas';

export interface SaleRoutesOptions {
  database: DatabaseClient;
}

export function registerSaleRoutes(app: FastifyInstance, options: SaleRoutesOptions): void {
  app.get('/sales', { preHandler: app.authenticate }, async (request) => {
    const query = parseInput(listSalesQuerySchema, request.query);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const result = await store.listSales(query);

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

  app.post('/sales', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseInput(createSaleSchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const sale = await store.createSale(input, request.authContext!.userId);
    return reply.code(201).send({ data: sale });
  });

  app.get('/sales/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(saleIdParamsSchema, request.params);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const sale = await store.findSale(id);
    if (!sale) throw new NotFoundError('Venda não encontrada.');
    return { data: sale };
  });

  app.patch('/sales/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(saleIdParamsSchema, request.params);
    const input = parseInput(updateSaleSchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const sale = await store.updateSale(id, input, request.authContext!.userId);
    if (!sale) throw new NotFoundError('Venda não encontrada.');
    return { data: sale };
  });

  app.delete(
    '/sales/:id',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const { id } = parseInput(saleIdParamsSchema, request.params);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const deleted = await store.deleteSale(id, request.authContext!.userId);
      if (!deleted) throw new NotFoundError('Venda não encontrada.');
      return reply.code(204).send();
    },
  );
}
