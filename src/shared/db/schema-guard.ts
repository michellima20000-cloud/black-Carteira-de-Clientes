import type { DatabaseClient } from './prisma';

/**
 * Garante que as tabelas usadas pela configuração do WhatsApp existam no banco.
 *
 * Ambientes onde o deploy não executa `prisma migrate deploy` (o Render executa
 * apenas `npm ci && npm run build` em alguns serviços) podem ficar com o schema
 * desatualizado. Todas as instruções abaixo são idempotentes: podem rodar
 * quantas vezes forem necessárias sem quebrar o banco.
 */
export async function ensureWhatsappConfigSchema(database: DatabaseClient): Promise<void> {
  await database.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "whatsapp_configs" (
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
    );
  `);

  await database.$executeRawUnsafe(
    `ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "phoneNumberId" VARCHAR(40);`,
  );

  await database.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_configs_accountId_key" ON "whatsapp_configs"("accountId");`,
  );

  await database.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_configs_accountId_fkey'
      ) THEN
        ALTER TABLE "whatsapp_configs"
          ADD CONSTRAINT "whatsapp_configs_accountId_fkey"
          FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  // Sessões do WhatsApp Web (QR Code) — credenciais e chaves criptografadas.
  await database.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
      "accountId" UUID NOT NULL,
      "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
      "phoneNumber" VARCHAR(24),
      "creds" TEXT NOT NULL DEFAULT '',
      "keys" TEXT NOT NULL DEFAULT '',
      "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("accountId")
    );
  `);

  await database.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_sessions_accountId_fkey'
      ) THEN
        ALTER TABLE "whatsapp_sessions"
          ADD CONSTRAINT "whatsapp_sessions_accountId_fkey"
          FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
}
