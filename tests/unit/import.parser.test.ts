import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  detectColumnMapping,
  parseCsvText,
  parseImportAmount,
  parseImportDate,
  parseSpreadsheetBuffer,
} from '../../src/modules/imports/import.parser';

describe('import parser', () => {
  it('faz parse de CSV com ponto e vírgula, BOM e aspas', () => {
    const csv = '\uFEFFNome;Telefone;Cidade;Data Venda;Valor\r\n"Maria, Silva";(11) 99999-1111;São Paulo;15/03/2026;"1.250,50"\r\n';
    const result = parseCsvText(csv);

    expect(result.headers).toEqual(['Nome', 'Telefone', 'Cidade', 'Data Venda', 'Valor']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      Nome: 'Maria, Silva',
      Telefone: '(11) 99999-1111',
      Cidade: 'São Paulo',
      'Data Venda': '15/03/2026',
      Valor: '1.250,50',
    });
  });

  it('detecta colunas automaticamente ignorando acentos e maiúsculas', () => {
    const mapping = detectColumnMapping(['Cliente', 'WhatsApp', 'Município', 'Data', 'Total', 'Obs']);
    expect(mapping).toEqual({
      name: 'Cliente',
      phone: 'WhatsApp',
      city: 'Município',
      soldAt: 'Data',
      amount: 'Total',
      observation: 'Obs',
    });
  });

  it('faz parse de datas BR, ISO e valores monetários', () => {
    expect(parseImportDate('25/11/2026')?.toISOString().slice(0, 10)).toBe('2026-11-25');
    expect(parseImportDate('2026-11-25')?.toISOString().slice(0, 10)).toBe('2026-11-25');
    expect(parseImportDate('31/02/2026')).toBeNull();

    expect(parseImportAmount('R$ 1.250,50')).toBe(1250.5);
    expect(parseImportAmount('1250.50')).toBe(1250.5);
    expect(parseImportAmount('0')).toBeNull();
  });

  it('faz parse de arquivo XLSX real', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Clientes');
    sheet.addRow(['Nome', 'Telefone', 'Cidade', 'Data Venda', 'Valor']);
    sheet.addRow(['João Souza', '11988887777', 'Campinas', '2026-11-10', 340.9]);

    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(rawBuffer);
    const parsed = await parseSpreadsheetBuffer(buffer, 'clientes.xlsx');

    expect(parsed.headers).toEqual(['Nome', 'Telefone', 'Cidade', 'Data Venda', 'Valor']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.Nome).toBe('João Souza');
    expect(parsed.rows[0]?.Valor).toBe(340.9);
  });
});
