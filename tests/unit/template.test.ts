import { describe, expect, it } from 'vitest';
import {
  buildCustomerTemplateVariables,
  extractTemplateVariables,
  renderTemplate,
} from '../../src/modules/templates/template.interpolator';
import {
  createTemplateSchema,
  reactivationOptionsSchema,
  updateTemplateSchema,
} from '../../src/modules/templates/template.schemas';

describe('Templates e Interpolação de Mensagens', () => {
  it('extrai variáveis de um conteúdo de template', () => {
    const content = 'Olá, {{ nome }}! Você está há {{ dias_inativo }} dias sem comprar na {{cidade}}.';
    const vars = extractTemplateVariables(content);
    expect(vars).toEqual(['nome', 'dias_inativo', 'cidade']);
  });

  it('monta variáveis do cliente e interpola corretamente', () => {
    const now = new Date('2026-11-25T12:00:00.000Z');
    const customer = {
      id: 'cust-1',
      name: 'Maria Oliveira Santos',
      phone: '5511999998888',
      city: 'São Paulo',
      lastPurchaseAt: new Date('2026-10-25T12:00:00.000Z'), // 31 dias
      owner: { name: 'Lucas Atendente' },
    };

    const vars = buildCustomerTemplateVariables(customer, now);
    expect(vars.primeiro_nome).toBe('Maria');
    expect(vars.dias_inativo).toBe('31');
    expect(vars.responsavel).toBe('Lucas Atendente');

    const template = 'Olá {{primeiro_nome}}, faz {{ dias_inativo }} dias! Fale com {{responsavel}}.';
    const rendered = renderTemplate(template, vars);
    expect(rendered).toBe('Olá Maria, faz 31 dias! Fale com Lucas Atendente.');
  });

  it('trata cliente sem compras registradas', () => {
    const customer = {
      id: 'cust-2',
      name: 'Carlos Alberto',
      phone: '5511988887777',
      city: null,
      lastPurchaseAt: null,
      owner: null,
    };

    const vars = buildCustomerTemplateVariables(customer);
    expect(vars.dias_inativo).toBe('indefinido');
    expect(vars.cidade).toBe('sua cidade');
    expect(vars.responsavel).toBe('nossa equipe');
  });

  it('valida schemas de criação e atualização de templates', () => {
    const valid = createTemplateSchema.parse({
      name: 'Reativação 30 Dias',
      content: 'Olá {{primeiro_nome}}, temos novidades imperdíveis para você!',
      category: 'MARKETING',
      status: 'APPROVED',
    });
    expect(valid.name).toBe('Reativação 30 Dias');
    expect(valid.status).toBe('APPROVED');

    expect(() =>
      createTemplateSchema.parse({
        name: 'A',
        content: 'Oi',
      }),
    ).toThrow();

    expect(() => updateTemplateSchema.parse({})).toThrow();
  });

  it('valida schema de opções de reativação', () => {
    const parsed = reactivationOptionsSchema.parse({
      templateId: '123e4567-e89b-12d3-a456-426614174000',
      inactiveDays: 45,
      includeNeverPurchased: 'false',
    });
    expect(parsed.inactiveDays).toBe(45);
    expect(parsed.includeNeverPurchased).toBe(false);
  });
});
