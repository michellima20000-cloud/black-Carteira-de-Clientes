import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { parseInput } from '../../shared/http/validation';
import {
  anonymizeCustomerSchema,
  customerIdParamsSchema,
  listAuditLogsQuerySchema,
} from './compliance.schemas';

export interface ComplianceRoutesOptions {
  database: DatabaseClient;
}

export function registerComplianceRoutes(
  app: FastifyInstance,
  options: ComplianceRoutesOptions,
): void {
  // Consulta de Auditoria
  app.get(
    '/audit-logs',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const query = parseInput(listAuditLogsQuerySchema, request.query);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const result = await store.listAuditLogs(query);

      return {
        data: result.items,
        meta: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
        },
      };
    },
  );

  // LGPD: Exportação dos Dados do Titular
  app.get(
    '/lgpd/customers/:id/export',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const { id } = parseInput(customerIdParamsSchema, request.params);
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const data = await store.exportCustomerData(id);
      return { data };
    },
  );

  // LGPD: Anonimização / Direito ao Esquecimento
  app.post(
    '/lgpd/customers/:id/anonymize',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const { id } = parseInput(customerIdParamsSchema, request.params);
      const input = parseInput(anonymizeCustomerSchema, request.body ?? {});
      const store = new TenantStore(options.database, request.authContext!.accountId);
      const anonymized = await store.anonymizeCustomer(
        id,
        input.reason,
        request.authContext!.userId,
      );
      return { data: anonymized };
    },
  );
}
