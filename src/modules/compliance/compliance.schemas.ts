import { z } from 'zod';

export const customerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listAuditLogsQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT']).optional(),
  entityType: z.string().trim().min(1).max(80).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const anonymizeCustomerSchema = z.object({
  reason: z.string().trim().min(3).max(240).default('Solicitação do titular (LGPD)'),
});

export type AnonymizeCustomerInput = z.infer<typeof anonymizeCustomerSchema>;
export type ListAuditLogsQueryInput = z.infer<typeof listAuditLogsQuerySchema>;
