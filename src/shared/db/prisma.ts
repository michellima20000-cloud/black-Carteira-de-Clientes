import { PrismaClient } from '@prisma/client';

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(databaseUrl: string, log = false): DatabaseClient {
  return new PrismaClient({
    datasourceUrl: databaseUrl,
    log: log ? ['warn', 'error'] : ['error'],
  });
}
