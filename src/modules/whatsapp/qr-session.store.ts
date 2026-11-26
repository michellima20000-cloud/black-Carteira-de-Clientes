import type { AuthenticationCreds, SignalDataSet, SignalKeyStore } from '@whiskeysockets/baileys';
import type { DatabaseClient } from '../../shared/db/prisma';
import { decryptSecret, encryptSecret } from '../../shared/security/secret-box';

/**
 * Serialização de Buffers no formato usado pelo Baileys.
 *
 * Implementado localmente (em vez de importar `BufferJSON` do Baileys) para que
 * o pacote do Baileys NÃO seja carregado durante o boot da API — assim uma
 * falha na biblioteca jamais derruba o serviço inteiro.
 */
function bufferReplacer(_key: string, value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { type: 'Buffer', data: Array.from(value) };
  }
  return value;
}

function bufferReviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return value;
}

function stringifyWithBuffers(value: unknown): string {
  return JSON.stringify(value, bufferReplacer);
}

function parseWithBuffers<T>(value: string): T {
  return JSON.parse(value, bufferReviver) as T;
}

export type StoredSessionStatus = 'PENDING' | 'CONNECTED' | 'DISCONNECTED';

export interface WhatsappSessionRow {
  accountId: string;
  status: StoredSessionStatus;
  phoneNumber: string | null;
  creds: AuthenticationCreds | null;
  keys: Record<string, Record<string, unknown>>;
}

/**
 * Converte o valor bruto de `app-state-sync-key` no objeto proto que o
 * Baileys v6 espera (mesma lógica do `use-multi-file-auth-state` oficial).
 * Sem essa conversão o handshake falha com o erro 515
 * ("Stream Errored - restart required").
 */
export type AppStateSyncKeyConverter = (value: unknown) => unknown;

/**
 * Persistência da sessão do WhatsApp Web (Baileys) no Postgres.
 *
 * Credenciais e chaves de sinal são gravadas criptografadas e restauradas a
 * cada start da API, evitando que o usuário precise escanear o QR novamente.
 *
 * Usa o model `WhatsappSession` do Prisma (sem SQL manual) para que a
 * persistência funcione em qualquer ambiente com as migrations aplicadas.
 */
export class WhatsappSessionStore {
  /** Cache em memória das chaves de sinal (evita perder o handshake em restarts). */
  private readonly caches = new Map<string, Record<string, Record<string, unknown>>>();

  constructor(
    private readonly database: DatabaseClient,
    private readonly encryptionKey: string,
  ) {}

  /** Verifica se a tabela de sessões está disponível no banco. */
  async ping(): Promise<{ ok: boolean; error: string | null }> {
    try {
      await this.database.whatsappSession.findFirst({ select: { accountId: true } });
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async load(accountId: string): Promise<WhatsappSessionRow | null> {
    const row = await this.database.whatsappSession.findUnique({ where: { accountId } });
    if (!row) return null;

    return {
      accountId: row.accountId,
      status: row.status as StoredSessionStatus,
      phoneNumber: row.phoneNumber,
      creds: row.creds
        ? parseWithBuffers<AuthenticationCreds>(decryptSecret(row.creds, this.encryptionKey))
        : null,
      keys: row.keys
        ? parseWithBuffers<Record<string, Record<string, unknown>>>(
            decryptSecret(row.keys, this.encryptionKey),
          )
        : {},
    };
  }

  async saveCredentials(accountId: string, creds: AuthenticationCreds): Promise<void> {
    const payload = encryptSecret(stringifyWithBuffers(creds), this.encryptionKey);

    await this.database.whatsappSession.upsert({
      where: { accountId },
      create: {
        accountId,
        status: 'PENDING',
        creds: payload,
        keys: this.encryptedEmptyKeys(),
      },
      update: {
        creds: payload,
        updatedAt: new Date(),
      },
    });
  }

  async saveKeys(accountId: string, keys: Record<string, Record<string, unknown>>): Promise<void> {
    const payload = encryptSecret(stringifyWithBuffers(keys), this.encryptionKey);

    await this.database.whatsappSession.upsert({
      where: { accountId },
      create: {
        accountId,
        status: 'PENDING',
        creds: this.encryptedEmptyCreds(),
        keys: payload,
      },
      update: {
        keys: payload,
        updatedAt: new Date(),
      },
    });
  }

  async updateStatus(
    accountId: string,
    status: StoredSessionStatus,
    phoneNumber?: string | null,
  ): Promise<void> {
    await this.database.whatsappSession.upsert({
      where: { accountId },
      create: {
        accountId,
        status,
        phoneNumber: phoneNumber ?? null,
        creds: this.encryptedEmptyCreds(),
        keys: this.encryptedEmptyKeys(),
      },
      update: {
        status,
        ...(phoneNumber ? { phoneNumber } : {}),
        updatedAt: new Date(),
      },
    });
  }

  async clear(accountId: string): Promise<void> {
    await this.database.whatsappSession.deleteMany({ where: { accountId } });
  }

  /** Implementação do SignalKeyStore do Baileys backed pelo Postgres. */
  createKeyStore(
    accountId: string,
    initial: Record<string, Record<string, unknown>>,
    options: { convertAppStateSyncKey?: AppStateSyncKeyConverter | undefined } = {},
  ): SignalKeyStore {
    const persisted = structuredClone(initial);
    const cached = this.caches.get(accountId);

    const cache: Record<string, Record<string, unknown>> = {};
    for (const [type, values] of Object.entries(persisted)) {
      cache[type] = { ...values };
    }
    if (cached) {
      for (const [type, values] of Object.entries(cached)) {
        cache[type] = { ...(cache[type] ?? {}), ...values };
      }
    }
    this.caches.set(accountId, cache);

    const saveKeys = (keys: Record<string, Record<string, unknown>>) =>
      this.saveKeys(accountId, keys);

    return {
      get: (type: string, ids: string[]) => {
        const data: Record<string, unknown> = {};
        const bucket = cache[type] ?? {};
        for (const id of ids) {
          const value = bucket[id];
          if (value === undefined) continue;

          if (type === 'app-state-sync-key' && options.convertAppStateSyncKey) {
            try {
              data[id] = options.convertAppStateSyncKey(value);
              continue;
            } catch {
              // Sem conversão o valor bruto é usado (evita quebrar o socket).
            }
          }

          data[id] = value;
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
