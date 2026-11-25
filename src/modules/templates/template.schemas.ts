import { z } from 'zod';

export const templateIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listTemplatesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'APPROVED']).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  content: z.string().trim().min(5).max(4_000),
  category: z.string().trim().max(80).nullable().optional(),
  status: z.enum(['DRAFT', 'APPROVED']).default('DRAFT'),
});

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    content: z.string().trim().min(5).max(4_000).optional(),
    category: z.string().trim().max(80).nullable().optional(),
    status: z.enum(['DRAFT', 'APPROVED']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export const reactivationOptionsSchema = z.object({
  templateId: z.string().uuid(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).default(30),
  includeNeverPurchased: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  customerIds: z.array(z.string().uuid()).min(1).max(500).optional(),
  ownerId: z.string().uuid().optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type ReactivationOptionsInput = z.infer<typeof reactivationOptionsSchema>;
