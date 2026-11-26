-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_sessions" (
    "accountId" UUID NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "phoneNumber" VARCHAR(24),
    "creds" TEXT NOT NULL DEFAULT '',
    "keys" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("accountId")
);

-- AddForeignKey
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
