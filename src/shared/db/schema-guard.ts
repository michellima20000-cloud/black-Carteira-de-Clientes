import type { DatabaseClient } from './prisma';

export interface SchemaGuardStatement {
  name: string;
  ok: boolean;
  error?: string;
}

export interface SchemaGuardStatus {
  ok: boolean;
  statements: SchemaGuardStatement[];
}

let lastStatus: SchemaGuardStatus = { ok: true, statements: [] };

export function getSchemaGuardStatus(): SchemaGuardStatus {
  return lastStatus;
}

/**
 * Garante que as tabelas usadas pela configuração do WhatsApp existam no banco.
 *
 * Ambientes onde o deploy não executa `prisma migrate deploy` (o Render executa
 * apenas `npm ci && npm run build` em alguns serviços) podem ficar com o schema
 * desatualizado. Todas as instruções abaixo são idempotentes: podem rodar
 * quantas vezes forem necessárias sem quebrar o banco.
 *
 * Cada instrução roda de forma independente: uma falha isolada não impede as
 * demais de serem aplicadas.
 */
export async function ensureWhatsappConfigSchema(database: DatabaseClient): Promise<void> {
  const statements: SchemaGuardStatement[] = [];

  const run = async (name: string, sql: string): Promise<void> => {
    try {
      await database.$executeRawUnsafe(sql);
      statements.push({ name, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statements.push({ name, ok: false, error: message });
    }
  };

  // Sessões do WhatsApp Web (QR Code) — credenciais e chaves criptografadas.
  await run(
    'create_whatsapp_sessions',
    `CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
      "accountId" UUID NOT NULL,
      "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
      "phoneNumber" VARCHAR(24),
      "creds" TEXT NOT NULL DEFAULT '',
      "keys" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("accountId")
    );`,
  );

  await run(
    'fk_whatsapp_sessions',
    `ALTER TABLE "whatsapp_sessions"
      ADD CONSTRAINT "whatsapp_sessions_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;`,
  );

  await run(
    'create_whatsapp_configs',
    `CREATE TABLE IF NOT EXISTS "whatsapp_configs" (
      "id" UUID NOT NULL,
      "accountId" UUID NOT NULL,
      "phoneNumber" VARCHAR(24) NOT NULL,
      "phoneNumberId" VARCHAR(40),
      "provider" VARCHAR(40) NOT NULL DEFAULT 'META',
      "accessTokenEncrypted" TEXT NOT NULL,
      "webhookSecretEncrypted" TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "whatsapp_configs_pkey" PRIMARY KEY ("id")
    );`,
  );

  await run(
    'add_whatsapp_configs_phone_number_id',
    `ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "phoneNumberId" VARCHAR(40);`,
  );

  await run(
    'index_whatsapp_configs_account',
    `CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_configs_accountId_key" ON "whatsapp_configs"("accountId");`,
  );

  await run(
    'fk_whatsapp_configs',
    `ALTER TABLE "whatsapp_configs"
      ADD CONSTRAINT "whatsapp_configs_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;`,
  );

  lastStatus = {
    ok: statements.every((statement) => statement.ok),
    statements,
  };
}
