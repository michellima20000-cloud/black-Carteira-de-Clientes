import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { AppError, ValidationError } from '../../shared/http/app-error';
import type { ColumnMapping } from './import.parser';
import { ImportService } from './import.service';

export interface ImportRoutesOptions {
  database: DatabaseClient;
}

const columnMappingSchema = z
  .object({
    name: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    soldAt: z.string().min(1).optional(),
    amount: z.string().min(1).optional(),
    observation: z.string().min(1).optional(),
  })
  .optional();

function parseFieldValue(field: unknown): string | undefined {
  if (!field || typeof field !== 'object' || !('value' in field)) return undefined;
  return typeof field.value === 'string' ? field.value : undefined;
}

function parseColumnMappingField(raw?: string): ColumnMapping | undefined {
  if (!raw) return undefined;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new ValidationError({ columnMapping: ['JSON inválido em columnMapping.'] });
  }

  const result = columnMappingSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new ValidationError(z.flattenError(result.error));
  }
  if (!result.data) return undefined;

  const mapping: ColumnMapping = {};
  if (result.data.name) mapping.name = result.data.name;
  if (result.data.phone) mapping.phone = result.data.phone;
  if (result.data.city) mapping.city = result.data.city;
  if (result.data.notes) mapping.notes = result.data.notes;
  if (result.data.soldAt) mapping.soldAt = result.data.soldAt;
  if (result.data.amount) mapping.amount = result.data.amount;
  if (result.data.observation) mapping.observation = result.data.observation;
  return mapping;
}

export function registerImportRoutes(app: FastifyInstance, options: ImportRoutesOptions): void {
  const service = new ImportService();

  app.post('/imports/preview', { preHandler: app.authenticate }, async (request) => {
    const file = await request.file();
    if (!file) {
      throw new AppError(400, 'FILE_REQUIRED', 'Envie um arquivo CSV ou XLSX.');
    }

    const buffer = await file.toBuffer();
    const columnMapping = parseColumnMappingField(parseFieldValue(file.fields.columnMapping));
    const store = new TenantStore(options.database, request.authContext!.accountId);

    const data = await service.preview(store, buffer, file.filename, columnMapping);
    return { data };
  });

  app.post('/imports/commit', { preHandler: app.authenticate }, async (request) => {
    const file = await request.file();
    if (!file) {
      throw new AppError(400, 'FILE_REQUIRED', 'Envie um arquivo CSV ou XLSX.');
    }

    const buffer = await file.toBuffer();
    const columnMapping = parseColumnMappingField(parseFieldValue(file.fields.columnMapping));
    const skipInvalid = parseFieldValue(file.fields.skipInvalid) !== 'false';
    const updateExistingCustomers =
      parseFieldValue(file.fields.updateExistingCustomers) === 'true';

    const store = new TenantStore(options.database, request.authContext!.accountId);
    const data = await service.commit(
      store,
      buffer,
      file.filename,
      { skipInvalid, updateExistingCustomers, columnMapping },
      request.authContext!.userId,
    );

    return { data };
  });
}
