import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import { getCurrentGoalMonthString } from './goal.calculator';
import {
  goalDashboardQuerySchema,
  goalIdParamsSchema,
  updateCustomerGoalParamsSchema,
  updateCustomerGoalSchema,
  upsertMonthlyGoalSchema,
} from './goal.schemas';

export interface GoalRoutesOptions {
  database: DatabaseClient;
}

export function registerGoalRoutes(app: FastifyInstance, options: GoalRoutesOptions): void {
  app.get('/goals', { preHandler: app.authenticate }, async (request) => {
    const store = new TenantStore(options.database, request.authContext!.accountId);
    return { data: await store.listMonthlyGoals() };
  });

  app.get('/goals/dashboard', { preHandler: app.authenticate }, async (request) => {
    const query = parseInput(goalDashboardQuerySchema, request.query);
    const month = query.month ?? getCurrentGoalMonthString();
    const store = new TenantStore(options.database, request.authContext!.accountId);
    return { data: await store.getMonthlyGoalDashboard(month) };
  });

  app.put(
    '/goals',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const input = parseInput(upsertMonthlyGoalSchema, request.body);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const dashboard = await store.upsertMonthlyGoal(input, request.authContext!.userId);
      return { data: dashboard };
    },
  );

  app.patch(
    '/goals/:id/customers/:customerId',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const { id, customerId } = parseInput(updateCustomerGoalParamsSchema, request.params);
      const { amount } = parseInput(updateCustomerGoalSchema, request.body);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const updated = await store.updateCustomerGoal(
        id,
        customerId,
        amount,
        request.authContext!.userId,
      );
      if (!updated) throw new NotFoundError('Meta ou cliente não encontrado.');
      return { data: updated };
    },
  );

  app.delete(
    '/goals/:id',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const { id } = parseInput(goalIdParamsSchema, request.params);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const deleted = await store.deleteMonthlyGoal(id, request.authContext!.userId);
      if (!deleted) throw new NotFoundError('Meta não encontrada.');
      return reply.code(204).send();
    },
  );
}
