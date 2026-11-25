import { describe, expect, it, vi } from 'vitest';
import { ImportService } from '../../src/modules/imports/import.service';
import type { TenantStore } from '../../src/shared/db/tenant-store';

describe('ImportService', () => {
  it('gera prévia identificando clientes novos, existentes e linhas inválidas', async () => {
    const service = new ImportService();
    const store = {
      findCustomersByPhones: vi.fn().mockResolvedValue(
        new Map([['5511999990001', { id: 'c1', name: 'Existente' }]]),
      ),
    } as unknown as TenantStore;

    const csv = [
      'Nome;Telefone;Cidade;Data Venda;Valor',
      'Ana Existente;(11) 99999-0001;São Paulo;10/11/2026;199,90',
      'Bruno Novo;(11) 99999-0002;Curitiba;;',
      'X;123;Curitiba;;',
    ].join('\n');

    const preview = await service.preview(store, Buffer.from(csv, 'utf8'), 'clientes.csv');

    expect(preview.summary).toEqual({
      totalRows: 3,
      validRows: 2,
      invalidRows: 1,
      newCustomers: 1,
      existingCustomers: 1,
      salesToCreate: 1,
    });
    expect(preview.rows[0]?.action).toBe('EXISTING_CUSTOMER');
    expect(preview.rows[1]?.action).toBe('CREATE_CUSTOMER');
    expect(preview.rows[2]?.status).toBe('INVALID');
  });

  it('confirma importação ignorando linhas inválidas quando skipInvalid=true', async () => {
    const service = new ImportService();
    const commitImport = vi.fn().mockResolvedValue({
      customersCreated: 1,
      customersUpdated: 0,
      salesCreated: 1,
    });
    const store = { commitImport } as unknown as TenantStore;

    const csv = [
      'Nome,Telefone,Data Venda,Valor',
      'Carla Dias,11988887777,2026-11-01,500.00',
      'Inválido,123,,',
    ].join('\n');

    const result = await service.commit(
      store,
      Buffer.from(csv, 'utf8'),
      'import.csv',
      { skipInvalid: true, updateExistingCustomers: false },
      'user-1',
    );

    expect(result).toEqual({
      customersCreated: 1,
      customersUpdated: 0,
      salesCreated: 1,
      skippedRows: 1,
    });
    expect(commitImport).toHaveBeenCalledTimes(1);
  });
});
