import { z } from 'zod';
import { isValidNormalizedPhone, normalizePhone } from './phone';

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizePhone(value))
  .refine((value) => isValidNormalizedPhone(value), {
    message: 'Telefone inválido. Informe DDD e número (10 a 15 dígitos).',
  });

export const customerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listCustomersQuerySchema = z.object({
  search: z.string().trim().min(1).max(160).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
  ownerId: z.string().uuid().optional(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const inactiveCustomersQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(30),
  includeNeverPurchased: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  ownerId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(160).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: phoneSchema,
  city: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
  nextContactAt: z.coerce.date().nullable().optional(),
});

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    phone: phoneSchema.optional(),
    city: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(5_000).nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
    nextContactAt: z.coerce.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
