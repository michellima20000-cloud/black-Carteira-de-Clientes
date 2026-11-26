-- Garante que a tabela tenha todas as colunas do model `WhatsappSession`.
-- Ambientes onde a tabela foi criada por versões anteriores do schema guard
-- podem estar sem a coluna "createdAt".

ALTER TABLE "whatsapp_sessions"
  ADD COLUMN IF NOT EXISTS "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "phoneNumber" VARCHAR(24),
  ADD COLUMN IF NOT EXISTS "creds" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "keys" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
