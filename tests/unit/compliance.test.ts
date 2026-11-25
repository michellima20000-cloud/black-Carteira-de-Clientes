import { describe, expect, it } from 'vitest';
import {
  anonymizeCustomerSchema,
  listAuditLogsQuerySchema,
} from '../../src/modules/compliance/compliance.schemas';

describe('Compliance & LGPD Schemas', () => {
  it('valida query de logs de auditoria com paginação e filtros', () => {
    const parsed = listAuditLogsQuerySchema.parse({
      action: 'UPDATE',
      entityType: 'Customer',
      page: 2,
      pageSize: 20,
    });
    expect(parsed.action).toBe('UPDATE');
    expect(parsed.entityType).toBe('Customer');
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(20);
  });

  it('valida schema de anonimização de cliente com motivo padrão', () => {
    const parsed = anonymizeCustomerSchema.parse({});
    expect(parsed.reason).toBe('Solicitação do titular (LGPD)');

    const custom = anonymizeCustomerSchema.parse({
      reason: 'Direito ao esquecimento exercido via DPO',
    });
    expect(custom.reason).toBe('Direito ao esquecimento exercido via DPO');
  });
});
