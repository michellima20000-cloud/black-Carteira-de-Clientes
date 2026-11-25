import { describe, expect, it } from 'vitest';
import { isValidNormalizedPhone, normalizePhone } from '../../src/modules/customers/phone';

describe('phone utilities', () => {
  it('normaliza telefones brasileiros com 10 ou 11 dígitos adicionando DDI 55', () => {
    expect(normalizePhone('(11) 99999-8888')).toBe('5511999998888');
    expect(normalizePhone('11 3333-4444')).toBe('551133334444');
    expect(normalizePhone('+55 (21) 98888-7777')).toBe('5521988887777');
  });

  it('mantém DDI internacional quando já informado', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671');
  });

  it('valida comprimento mínimo e máximo do telefone normalizado', () => {
    expect(isValidNormalizedPhone('5511999998888')).toBe(true);
    expect(isValidNormalizedPhone('12345')).toBe(false);
    expect(isValidNormalizedPhone('')).toBe(false);
  });
});
