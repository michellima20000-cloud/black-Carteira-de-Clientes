import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import {
  createCustomerSchema,
  customerIdParamsSchema,
  inactiveCustomersQuerySchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from './customer.schemas';

export interface CustomerRoutesOptions {
  database: DatabaseClient;
}

export function registerCustomerRoutes(app: FastifyInstance, options: CustomerRoutesOptions): void {
  app.get('/customers', { preHandler: app.authenticate }, async (request) => {
    const query = parseInput(listCustomersQuerySchema, request.query);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const result = await store.listCustomers(query);

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

  app.get('/customers/inactive', { preHandler: app.authenticate }, async (request) => {
    const query = parseInput(inactiveCustomersQuerySchema, request.query);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const result = await store.listInactiveCustomers(query);
    const now = Date.now();

    const items = result.items.map((customer) => ({
      ...customer,
      daysSinceLastPurchase: customer.lastPurchaseAt
        ? Math.floor((now - customer.lastPurchaseAt.getTime()) / 86_400_000)
        : null,
    }));

    return {
      data: items,
      meta: {
        days: query.days,
        includeNeverPurchased: query.includeNeverPurchased,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      },
    };
  });

  app.post('/customers', { preHandler: app.authenticate }, async (request, reply) => {
    const input = parseInput(createCustomerSchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const customer = await store.createCustomer(input, request.authContext!.userId);
    return reply.code(201).send({ data: customer });
  });

  app.get('/customers/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(customerIdParamsSchema, request.params);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const customer = await store.findCustomer(id);
    if (!customer) throw new NotFoundError('Cliente não encontrado.');
    return { data: customer };
  });

  app.patch('/customers/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(customerIdParamsSchema, request.params);
    const input = parseInput(updateCustomerSchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const customer = await store.updateCustomer(id, input, request.authContext!.userId);
    if (!customer) throw new NotFoundError('Cliente não encontrado.');
    return { data: customer };
  });

  app.delete(
    '/customers/:id',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const { id } = parseInput(customerIdParamsSchema, request.params);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const deleted = await store.deleteCustomer(id, request.authContext!.userId);
      if (!deleted) throw new NotFoundError('Cliente não encontrado.');
      return reply.code(204).send();
    },
  );
}
