import ExcelJS from 'exceljs';
import { AppError } from '../../shared/http/app-error';

export const MAX_IMPORT_ROWS = 5_000;

export type ImportColumnField =
  | 'name'
  | 'phone'
  | 'city'
  | 'notes'
  | 'soldAt'
  | 'amount'
  | 'observation';

export type ColumnMapping = Partial<Record<ImportColumnField, string>>;

export interface ParsedSpreadsheet {
  headers: string[];
  rows: Record<string, unknown>[];
}

const HEADER_ALIASES: Record<ImportColumnField, readonly string[]> = {
  name: ['nome', 'name', 'cliente', 'customer', 'razao_social', 'nome_cliente'],
  phone: ['telefone', 'phone', 'celular', 'whatsapp', 'fone', 'contato', 'tel'],
  city: ['cidade', 'city', 'municipio'],
  notes: ['observacoes', 'observacao_cliente', 'notes', 'nota', 'notas'],
  soldAt: ['data_venda', 'data', 'sold_at', 'soldat', 'data_compra', 'ultima_compra'],
  amount: ['valor', 'amount', 'total', 'valor_venda', 'preco'],
  observation: ['observacao', 'obs', 'observation', 'descricao', 'detalhes'],
};

export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function detectColumnMapping(
  headers: string[],
  override?: ColumnMapping,
): ColumnMapping {
  const normalizedToOriginal = new Map<string, string>();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (normalized && !normalizedToOriginal.has(normalized)) {
      normalizedToOriginal.set(normalized, header);
    }
  }

  const mapping: ColumnMapping = {};
  for (const field of Object.keys(HEADER_ALIASES) as ImportColumnField[]) {
    const overridden = override?.[field];
    if (overridden) {
      mapping[field] = overridden;
      continue;
    }

    for (const alias of HEADER_ALIASES[field]) {
      const match = normalizedToOriginal.get(alias);
      if (match) {
        mapping[field] = match;
        break;
      }
    }
  }

  return mapping;
}

function detectCsvDelimiter(firstLine: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;

  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === ',') commas += 1;
    else if (!inQuotes && char === ';') semicolons += 1;
  }

  return semicolons > commas ? ';' : ',';
}

export function parseCsvText(content: string): ParsedSpreadsheet {
  const clean = content.replace(/^\uFEFF/, '');
  if (!clean.trim()) {
    return { headers: [], rows: [] };
  }

  const firstNewline = clean.search(/\r?\n/);
  const firstLine = firstNewline === -1 ? clean : clean.slice(0, firstNewline);
  const delimiter = detectCsvDelimiter(firstLine);

  const records: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]!;
    const next = clean[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        currentField += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\r' && next === '\n') {
      currentRow.push(currentField.trim());
      records.push(currentRow);
      currentRow = [];
      currentField = '';
      index += 1;
    } else if (char === '\n' || char === '\r') {
      currentRow.push(currentField.trim());
      records.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    records.push(currentRow);
  }

  const nonEmptyRecords = records.filter((record) => record.some((cell) => cell !== ''));
  if (nonEmptyRecords.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = nonEmptyRecords[0]!.map((header, idx) => header || `col_${idx + 1}`);
  const dataRecords = nonEmptyRecords.slice(1);
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      400,
      'IMPORT_LIMIT_EXCEEDED',
      `A planilha excede o limite de ${MAX_IMPORT_ROWS} linhas por importação.`,
    );
  }

  const rows = dataRecords.map((record) => {
    const row: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      row[header] = record[idx] ?? '';
    });
    return row;
  });

  return { headers, rows };
}

function unwrapExcelCell(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return value.result;
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
  }
  return value;
}

export async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  await workbook.xlsx.load(arrayBuffer as ArrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { headers: [], rows: [] };
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = String(unwrapExcelCell(cell.value)).trim();
    headers[colNumber - 1] = text || `col_${colNumber}`;
  });

  if (headers.length === 0) {
    return { headers: [], rows: [] };
  }

  const rows: Record<string, unknown>[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const row: Record<string, unknown> = {};
    let hasValue = false;

    headers.forEach((header, idx) => {
      if (!header) return;
      const cellValue = unwrapExcelCell(excelRow.getCell(idx + 1).value);
      if (cellValue !== '' && cellValue !== null && cellValue !== undefined) {
        hasValue = true;
      }
      row[header] = cellValue;
    });

    if (hasValue) {
      if (rows.length >= MAX_IMPORT_ROWS) {
        throw new AppError(
          400,
          'IMPORT_LIMIT_EXCEEDED',
          `A planilha excede o limite de ${MAX_IMPORT_ROWS} linhas por importação.`,
        );
      }
      rows.push(row);
    }
  }

  return { headers: headers.filter(Boolean), rows };
}

export async function parseSpreadsheetBuffer(
  buffer: Buffer,
  filename: string,
): Promise<ParsedSpreadsheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseCsvText(buffer.toString('utf8'));
  }
  if (lower.endsWith('.xlsx')) {
    return parseXlsxBuffer(buffer);
  }
  throw new AppError(400, 'UNSUPPORTED_FILE_TYPE', 'Formato inválido. Envie um arquivo .csv ou .xlsx.');
}

export function toCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return '';
}

export function parseImportDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = toCellText(value);
  if (!text) return null;

  // DD/MM/YYYY
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date;
    }
    return null;
  }

  // YYYY-MM-DD or ISO
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (isoMatch) {
    const date = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function parseImportAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
  }

  const raw = toCellText(value)
    .replace(/^R\$\s*/i, '')
    .replace(/\s+/g, '');
  if (!raw) return null;

  let normalized = raw;
  if (raw.includes(',') && raw.includes('.')) {
    // 1.234,56 -> 1234.56 (BR) or 1,234.56 -> 1234.56 (US)
    normalized =
      raw.lastIndexOf(',') > raw.lastIndexOf('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    normalized = raw.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}
