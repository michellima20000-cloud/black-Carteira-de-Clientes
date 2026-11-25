import type { AuthenticationCreds, SignalDataSet, SignalKeyStore } from '@whiskeysockets/baileys';
import { BufferJSON } from '@whiskeysockets/baileys';
import type { DatabaseClient } from '../../shared/db/prisma';
import { decryptSecret, encryptSecret } from '../../shared/security/secret-box';

export type StoredSessionStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED';

export interface WhatsappSessionRow {
  accountId: string;
  status: StoredSessionStatus;
  phoneNumber: string | null;
  creds: AuthenticationCreds | null;
  keys: Record<string, Record<string, unknown>>;
}

const TABLE = '"whatsapp_sessions"';

/**
 * Persistência da sessão do WhatsApp Web (Baileys) no Postgres.
 *
 * Credenciais e chaves de sinal são gravadas criptografadas e restauradas
 * a cada start da API, evitando que o usuário precise escanear o QR novamente.
 */
export class WhatsappSessionStore {
  constructor(
    private readonly database: DatabaseClient,
    private readonly encryptionKey: string,
  ) {}

  async load(accountId: string): Promise<WhatsappSessionRow | null> {
    const rows = await this.database.$queryRawUnsafe<{
      accountId: string;
      status: StoredSessionStatus;
      phoneNumber: string | null;
      creds: string;
      keys: string;
    }[]>(
      `SELECT "accountId", "status", "phoneNumber", "creds", "keys" FROM ${TABLE} WHERE "accountId" = $1`,
      accountId,
    );

    const row = rows[0];
    if (!row) return null;

    return {
      accountId: row.accountId,
      status: row.status,
      phoneNumber: row.phoneNumber,
      creds: row.creds ? (JSON.parse(decryptSecret(row.creds, this.encryptionKey)) as AuthenticationCreds) : null,
      keys: row.keys
        ? (JSON.parse(decryptSecret(row.keys, this.encryptionKey)) as Record<
            string,
            Record<string, unknown>
          >)
        : {},
    };
  }

  async saveCredentials(accountId: string, creds: AuthenticationCreds): Promise<void> {
    const payload = encryptSecret(
      JSON.stringify(creds, BufferJSON.replacer),
      this.encryptionKey,
    );

    await this.database.$queryRawUnsafe(
      `
      INSERT INTO ${TABLE} ("accountId", "status", "phoneNumber", "creds", "keys", "updatedAt")
      VALUES ($1, 'PENDING', NULL, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT ("accountId") DO UPDATE
        SET "creds" = EXCLUDED."creds", "updatedAt" = CURRENT_TIMESTAMP
      `,
      accountId,
      payload,
      this.encryptedEmptyKeys(),
    );
  }

  async saveKeys(accountId: string, keys: Record<string, Record<string, unknown>>): Promise<void> {
    const payload = encryptSecret(JSON.stringify(keys, BufferJSON.replacer), this.encryptionKey);

    await this.database.$queryRawUnsafe(
      `
      INSERT INTO ${TABLE} ("accountId", "status", "phoneNumber", "creds", "keys", "updatedAt")
      VALUES ($1, 'PENDING', NULL, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT ("accountId") DO UPDATE
        SET "keys" = EXCLUDED."keys", "updatedAt" = CURRENT_TIMESTAMP
      `,
      accountId,
      this.encryptedEmptyCreds(),
      payload,
    );
  }

  async updateStatus(
    accountId: string,
    status: StoredSessionStatus,
    phoneNumber?: string | null,
  ): Promise<void> {
    await this.database.$queryRawUnsafe(
      `
      INSERT INTO ${TABLE} ("accountId", "status", "phoneNumber", "creds", "keys", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT ("accountId") DO UPDATE
        SET "status" = EXCLUDED."status",
            "phoneNumber" = COALESCE(EXCLUDED."phoneNumber", ${TABLE}."phoneNumber"),
            "updatedAt" = CURRENT_TIMESTAMP
      `,
      accountId,
      status,
      phoneNumber ?? null,
      this.encryptedEmptyCreds(),
      this.encryptedEmptyKeys(),
    );
  }

  async clear(accountId: string): Promise<void> {
    await this.database.$queryRawUnsafe(`DELETE FROM ${TABLE} WHERE "accountId" = $1`, accountId);
  }

  /** Implementação do SignalKeyStore do Baileys backed pelo Postgres. */
  createKeyStore(accountId: string, initial: Record<string, Record<string, unknown>>): SignalKeyStore {
    const cache: Record<string, Record<string, unknown>> = structuredClone(initial);
    const saveKeys = (keys: Record<string, Record<string, unknown>>) =>
      this.saveKeys(accountId, keys);

    return {
      get: (type: string, ids: string[]) => {
        const data: Record<string, unknown> = {};
        const bucket = cache[type] ?? {};
        for (const id of ids) {
          if (bucket[id] !== undefined) {
            data[id] = bucket[id];
          }
        }
        return Promise.resolve(data as never);
      },
      set: async (data: SignalDataSet) => {
        for (const [type, values] of Object.entries(data)) {
          const bucket = (cache[type] ??= {});
          for (const [id, value] of Object.entries(values as Record<string, unknown>)) {
            if (value === null || value === undefined) {
              delete bucket[id];
            } else {
              bucket[id] = value;
            }
          }
        }
        await saveKeys(cache);
      },
      clear: async () => {
        for (const key of Object.keys(cache)) {
          delete cache[key];
        }
        await saveKeys(cache);
      },
    };
  }

  private encryptedEmptyCreds(): string {
    return encryptSecret(JSON.stringify({}), this.encryptionKey);
  }

  private encryptedEmptyKeys(): string {
    return encryptSecret(JSON.stringify({}), this.encryptionKey);
  }
}
