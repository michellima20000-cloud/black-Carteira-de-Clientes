import { z } from 'zod';

export const saleIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listSalesQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  source: z.enum(['MANUAL', 'IMPORT']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const createSaleSchema = z.object({
  customerId: z.string().uuid(),
  soldAt: z.coerce.date(),
  amount: z.coerce.number().positive().max(999_999_999.99),
  observation: z.string().trim().max(2_000).nullable().optional(),
});

export const updateSaleSchema = z
  .object({
    soldAt: z.coerce.date().optional(),
    amount: z.coerce.number().positive().max(999_999_999.99).optional(),
    observation: z.string().trim().max(2_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });
