import type { ImportCommitResult, ImportCommitRow, TenantStore } from '../../shared/db/tenant-store';
import { AppError, ValidationError } from '../../shared/http/app-error';
import { isValidNormalizedPhone, normalizePhone } from '../customers/phone';
import {
  detectColumnMapping,
  parseImportAmount,
  parseImportDate,
  parseSpreadsheetBuffer,
  toCellText,
  type ColumnMapping,
} from './import.parser';

export interface ImportRowPreview {
  rowNumber: number;
  status: 'VALID' | 'INVALID';
  action: 'CREATE_CUSTOMER' | 'EXISTING_CUSTOMER' | 'SKIP';
  errors: string[];
  data: {
    name: string;
    phone: string;
    city: string | null;
    notes: string | null;
    soldAt: string | null;
    amount: number | null;
    observation: string | null;
  };
}

export interface ImportPreviewResponse {
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    newCustomers: number;
    existingCustomers: number;
    salesToCreate: number;
  };
  detectedColumns: ColumnMapping;
  rows: ImportRowPreview[];
}

export interface ImportCommitResponse extends ImportCommitResult {
  skippedRows: number;
}

interface NormalizedRow {
  rowNumber: number;
  errors: string[];
  commitRow?: ImportCommitRow;
  previewData: ImportRowPreview['data'];
}

function readCellString(row: Record<string, unknown>, column?: string): string {
  if (!column) return '';
  return toCellText(row[column]);
}

function hasCellValue(row: Record<string, unknown>, column?: string): boolean {
  return readCellString(row, column) !== '';
}

function validateAndNormalizeRows(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping,
): NormalizedRow[] {
  return rows.map((rawRow, index) => {
    const rowNumber = index + 2; // +1 header, +1 1-based
    const errors: string[] = [];

    const name = readCellString(rawRow, mapping.name);
    if (name.length < 2) {
      errors.push('Nome deve ter pelo menos 2 caracteres.');
    }

    const rawPhone = readCellString(rawRow, mapping.phone);
    const phone = normalizePhone(rawPhone);
    if (!isValidNormalizedPhone(phone)) {
      errors.push('Telefone inválido.');
    }

    const city = readCellString(rawRow, mapping.city) || null;
    const notes = readCellString(rawRow, mapping.notes) || null;
    const observation = readCellString(rawRow, mapping.observation) || null;

    const hasSoldAt = hasCellValue(rawRow, mapping.soldAt);
    const hasAmount = hasCellValue(rawRow, mapping.amount);

    let soldAt: Date | undefined;
    let amount: number | undefined;

    if (hasSoldAt || hasAmount) {
      const parsedDate = mapping.soldAt ? parseImportDate(rawRow[mapping.soldAt]) : null;
      const parsedAmount = mapping.amount ? parseImportAmount(rawRow[mapping.amount]) : null;

      if (!parsedDate) {
        errors.push('Data da venda inválida (use DD/MM/AAAA ou AAAA-MM-DD).');
      } else {
        soldAt = parsedDate;
      }

      if (parsedAmount === null) {
        errors.push('Valor da venda inválido.');
      } else {
        amount = parsedAmount;
      }
    }

    const previewData: ImportRowPreview['data'] = {
      name,
      phone,
      city,
      notes,
      soldAt: soldAt ? soldAt.toISOString().slice(0, 10) : null,
      amount: amount ?? null,
      observation,
    };

    if (errors.length > 0) {
      return { rowNumber, errors, previewData };
    }

    return {
      rowNumber,
      errors: [],
      previewData,
      commitRow: {
        name,
        phone,
        city,
        notes,
        soldAt,
        amount,
        observation,
      },
    };
  });
}

export class ImportService {
  async preview(
    store: TenantStore,
    buffer: Buffer,
    filename: string,
    columnMappingOverride?: ColumnMapping,
  ): Promise<ImportPreviewResponse> {
    const parsed = await parseSpreadsheetBuffer(buffer, filename);
    if (parsed.rows.length === 0) {
      throw new AppError(400, 'EMPTY_IMPORT_FILE', 'A planilha não possui linhas para importar.');
    }

    const detectedColumns = detectColumnMapping(parsed.headers, columnMappingOverride);
    if (!detectedColumns.name || !detectedColumns.phone) {
      throw new AppError(
        400,
        'MISSING_REQUIRED_COLUMNS',
        'Não foi possível identificar as colunas obrigatórias de nome e telefone.',
        { headers: parsed.headers, detectedColumns },
      );
    }

    const normalizedRows = validateAndNormalizeRows(parsed.rows, detectedColumns);
    const validPhones = [
      ...new Set(normalizedRows.filter((row) => row.commitRow).map((row) => row.commitRow!.phone)),
    ];
    const existingByPhone = await store.findCustomersByPhones(validPhones);

    const seenNewPhones = new Set<string>();
    let validRows = 0;
    let invalidRows = 0;
    let newCustomers = 0;
    let existingCustomers = 0;
    let salesToCreate = 0;

    const previewRows: ImportRowPreview[] = normalizedRows.map((row) => {
      if (row.errors.length > 0 || !row.commitRow) {
        invalidRows += 1;
        return {
          rowNumber: row.rowNumber,
          status: 'INVALID',
          action: 'SKIP',
          errors: row.errors,
          data: row.previewData,
        };
      }

      validRows += 1;
      if (row.commitRow.soldAt && row.commitRow.amount !== undefined) {
        salesToCreate += 1;
      }

      const existsInDb = existingByPhone.has(row.commitRow.phone);
      const alreadySeenNew = seenNewPhones.has(row.commitRow.phone);
      const isExisting = existsInDb || alreadySeenNew;

      if (isExisting) {
        existingCustomers += 1;
      } else {
        seenNewPhones.add(row.commitRow.phone);
        newCustomers += 1;
      }

      return {
        rowNumber: row.rowNumber,
        status: 'VALID',
        action: isExisting ? 'EXISTING_CUSTOMER' : 'CREATE_CUSTOMER',
        errors: [],
        data: row.previewData,
      };
    });

    return {
      summary: {
        totalRows: normalizedRows.length,
        validRows,
        invalidRows,
        newCustomers,
        existingCustomers,
        salesToCreate,
      },
      detectedColumns,
      rows: previewRows,
    };
  }

  async commit(
    store: TenantStore,
    buffer: Buffer,
    filename: string,
    options: {
      skipInvalid: boolean;
      updateExistingCustomers: boolean;
      columnMapping?: ColumnMapping | undefined;
    },
    actorUserId: string,
  ): Promise<ImportCommitResponse> {
    const parsed = await parseSpreadsheetBuffer(buffer, filename);
    if (parsed.rows.length === 0) {
      throw new AppError(400, 'EMPTY_IMPORT_FILE', 'A planilha não possui linhas para importar.');
    }

    const detectedColumns = detectColumnMapping(parsed.headers, options.columnMapping);
    if (!detectedColumns.name || !detectedColumns.phone) {
      throw new AppError(
        400,
        'MISSING_REQUIRED_COLUMNS',
        'Não foi possível identificar as colunas obrigatórias de nome e telefone.',
        { headers: parsed.headers, detectedColumns },
      );
    }

    const normalizedRows = validateAndNormalizeRows(parsed.rows, detectedColumns);
    const invalidRows = normalizedRows.filter((row) => row.errors.length > 0);

    if (!options.skipInvalid && invalidRows.length > 0) {
      throw new ValidationError({
        rows: invalidRows.slice(0, 50).map((row) => ({
          rowNumber: row.rowNumber,
          errors: row.errors,
        })),
      });
    }

    const validCommitRows = normalizedRows
      .filter((row) => row.commitRow !== undefined)
      .map((row) => row.commitRow!);

    if (validCommitRows.length === 0) {
      throw new AppError(400, 'NO_VALID_ROWS', 'Nenhuma linha válida encontrada para importar.');
    }

    const result = await store.commitImport(
      validCommitRows,
      { updateExistingCustomers: options.updateExistingCustomers },
      actorUserId,
    );

    return {
      ...result,
      skippedRows: invalidRows.length,
    };
  }
}
