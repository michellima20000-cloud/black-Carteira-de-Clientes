import { z } from 'zod';

const phoneNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ''))
  .refine((value) => value.length >= 8 && value.length <= 15, {
    message: 'Informe o número do WhatsApp com DDD (8 a 15 dígitos).',
  });

export const whatsappConfigBodySchema = z.object({
  phoneNumber: phoneNumberSchema,
  phoneNumberId: z
    .string()
    .trim()
    .min(6)
    .max(40)
    .regex(/^[0-9]+$/, 'O Phone Number ID da Meta contém apenas números.')
    .optional(),
  provider: z.enum(['META']).default('META'),
  accessToken: z.string().trim().min(10).max(4096),
  webhookSecret: z
    .string()
    .trim()
    .min(8)
    .max(256)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const whatsappWebhookSecretSchema = z.object({
  secret: z.string().trim().min(8).max(256),
});

export type WhatsappConfigBody = z.infer<typeof whatsappConfigBodySchema>;
