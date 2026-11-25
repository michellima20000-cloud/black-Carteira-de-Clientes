import { z } from 'zod';

const monthStringSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Informe o mês no formato YYYY-MM.');

export const goalIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const goalDashboardQuerySchema = z.object({
  month: monthStringSchema.optional(),
});

export const upsertMonthlyGoalSchema = z.object({
  month: monthStringSchema,
  totalAmount: z.coerce.number().positive().max(999_999_999.99),
  distributionMode: z.enum(['EQUAL', 'HISTORICAL']).default('EQUAL'),
  customerIds: z.array(z.string().uuid()).min(1).max(5_000).optional(),
  historicalMonths: z.coerce.number().int().min(1).max(24).default(3),
});

export const updateCustomerGoalParamsSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
});

export const updateCustomerGoalSchema = z.object({
  amount: z.coerce.number().min(0).max(999_999_999.99),
});

export type UpsertMonthlyGoalInput = z.infer<typeof upsertMonthlyGoalSchema>;
