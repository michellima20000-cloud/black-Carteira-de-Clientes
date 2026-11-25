import { describe, expect, it } from 'vitest';
import {
  createBlocklistEntrySchema,
  createQuickReplySchema,
  genericWebhookPayloadSchema,
  sendConversationMessageSchema,
  updateConversationStatusSchema,
} from '../../src/modules/whatsapp/whatsapp.schemas';

describe('WhatsApp e Atendimento Schemas', () => {
  it('valida mensagem enviada em conversa', () => {
    expect(() => sendConversationMessageSchema.parse({ body: 'Olá, como posso ajudar?' })).not.toThrow();
    expect(() => sendConversationMessageSchema.parse({ body: '   ' })).toThrow();
  });

  it('valida transição de status de conversa', () => {
    expect(
      updateConversationStatusSchema.parse({
        status: 'EM_ATENDIMENTO',
        assignedUserId: '123e4567-e89b-12d3-a456-426614174000',
      }),
    ).toEqual({
      status: 'EM_ATENDIMENTO',
      assignedUserId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(() => updateConversationStatusSchema.parse({ status: 'INVALID_STATUS' })).toThrow();
  });

  it('valida criação de resposta rápida', () => {
    const quickReply = createQuickReplySchema.parse({
      name: 'Boas-vindas',
      trigger: '#ola',
      text: 'Olá! Seja bem-vindo à nossa loja.',
    });
    expect(quickReply.name).toBe('Boas-vindas');
    expect(quickReply.active).toBe(true);
  });

  it('valida e normaliza telefone na blocklist', () => {
    const entry = createBlocklistEntrySchema.parse({
      phone: '(11) 98888-7777',
      reason: 'Spam excessivo',
    });
    expect(entry.phone).toBe('5511988887777');
    expect(entry.reason).toBe('Spam excessivo');
  });

  it('valida payload genérico do webhook', () => {
    const payload = genericWebhookPayloadSchema.parse({
      fromPhone: '11977776666',
      body: 'Gostaria de saber o valor do produto',
      externalId: 'wamid.HBgLMTIzNDU2',
    });
    expect(payload.fromPhone).toBe('5511977776666');
    expect(payload.provider).toBe('META');
  });
});
