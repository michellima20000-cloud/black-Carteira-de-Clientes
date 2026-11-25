import { describe, expect, it } from 'vitest';
import {
  whatsappConfigBodySchema,
  type WhatsappConfigBody,
} from '../../src/modules/whatsapp/whatsapp-config.schemas';
import {
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
} from '../../src/shared/security/secret-box';

describe('WhatsApp config', () => {
  it('normaliza o número do WhatsApp', () => {
    const parsed = whatsappConfigBodySchema.parse({
      phoneNumber: '+55 (11) 98888-7777',
      accessToken: 'EAAGZ-test-token-value',
    });

    expect(parsed.phoneNumber).toBe('5511988887777');
    expect(parsed.provider).toBe('META');
    expect(parsed.phoneNumberId).toBeUndefined();
  });

  it('exige access token válido', () => {
    expect(() =>
      whatsappConfigBodySchema.parse({ phoneNumber: '5511988887777', accessToken: 'curto' }),
    ).toThrow();
  });

  it('rejeita Phone Number ID com letras', () => {
    expect(() =>
      whatsappConfigBodySchema.parse({
        phoneNumber: '5511988887777',
        phoneNumberId: 'abc123',
        accessToken: 'EAAGZ-test-token-value',
      }),
    ).toThrow();
  });

  it('criptografa e descriptografa segredos', () => {
    const secret = 'segredo-super-secreto';
    const encrypted = encryptSecret(secret, 'chave-de-teste-32-caracteres-min');

    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(encrypted, 'chave-de-teste-32-caracteres-min')).toBe(secret);
  });

  it('mantém compatibilidade com segredos legados em texto puro', () => {
    expect(decryptSecret('token-em-plano', 'chave-de-teste')).toBe('token-em-plano');
  });

  it('gera token de webhook aleatório', () => {
    const first = generateWebhookSecret();
    const second = generateWebhookSecret();

    expect(first).toHaveLength(48);
    expect(first).not.toBe(second);
  });

  it('aceita corpo de configuração sem webhook secret explícito', () => {
    const body: WhatsappConfigBody = {
      phoneNumber: '5511988887777',
      provider: 'META',
      accessToken: 'EAAGZ-test-token-value',
    };

    expect(body.provider).toBe('META');
  });
});
