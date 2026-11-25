import { z } from 'zod';
import { isValidNormalizedPhone, normalizePhone } from '../customers/phone';

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizePhone(value))
  .refine((value) => isValidNormalizedPhone(value), {
    message: 'Telefone inválido. Informe DDD e número (10 a 15 dígitos).',
  });

export const conversationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listConversationsQuerySchema = z.object({
  status: z.enum(['BOT', 'AGUARDANDO_HUMANO', 'EM_ATENDIMENTO', 'FINALIZADA']).optional(),
  assignedUserId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendConversationMessageSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export const updateConversationStatusSchema = z.object({
  status: z.enum(['BOT', 'AGUARDANDO_HUMANO', 'EM_ATENDIMENTO', 'FINALIZADA']),
  assignedUserId: z.string().uuid().nullable().optional(),
});

export const assignConversationSchema = z.object({
  assignedUserId: z.string().uuid().nullable(),
});

// Quick Replies
export const quickReplyIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createQuickReplySchema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: z.string().trim().max(120).nullable().optional(),
  text: z.string().trim().min(1).max(5_000),
  active: z.boolean().default(true),
});

export const updateQuickReplySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    trigger: z.string().trim().max(120).nullable().optional(),
    text: z.string().trim().min(1).max(5_000).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

// Blocklist
export const blocklistIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createBlocklistEntrySchema = z.object({
  phone: phoneSchema,
  reason: z.string().trim().max(240).nullable().optional(),
});

// Webhook
export const metaWebhookQuerySchema = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

export const genericWebhookPayloadSchema = z.object({
  fromPhone: phoneSchema,
  body: z.string().trim().min(1),
  externalId: z.string().trim().min(1).max(255).optional(),
  provider: z.string().trim().max(40).default('META'),
});

export type SendConversationMessageInput = z.infer<typeof sendConversationMessageSchema>;
export type UpdateConversationStatusInput = z.infer<typeof updateConversationStatusSchema>;
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;
export type CreateQuickReplyInput = z.infer<typeof createQuickReplySchema>;
export type UpdateQuickReplyInput = z.infer<typeof updateQuickReplySchema>;
export type CreateBlocklistEntryInput = z.infer<typeof createBlocklistEntrySchema>;
export type GenericWebhookPayload = z.infer<typeof genericWebhookPayloadSchema>;
