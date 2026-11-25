import makeWASocket, {
  Browsers,
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  type AuthenticationCreds,
  type WASocket,
} from '@whiskeysockets/baileys';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { WhatsappSessionStore, type WhatsappSessionRow } from './qr-session.store';

export type QrSessionStatus =
  | 'IDLE'
  | 'CONNECTING'
  | 'AWAITING_SCAN'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR';

export interface QrSessionState {
  status: QrSessionStatus;
  qr: string | null;
  pairingCode: string | null;
  phoneNumber: string | null;
  error: string | null;
  updatedAt: string;
}

interface SessionRuntime {
  socket: WASocket;
  state: QrSessionState;
}

function jidToPhone(jid: string | null | undefined): string {
  if (!jid) return '';
  const user = jid.split('@')[0] ?? '';
  return user.replace(/\D/g, '');
}

function phoneToJid(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

function extractText(message: unknown): string {
  const content = message as
    | {
        conversation?: string;
        extendedTextMessage?: { text?: string };
        imageMessage?: { caption?: string };
        videoMessage?: { caption?: string };
      }
    | undefined;

  return (
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    ''
  );
}

export interface WhatsappSessionManagerOptions {
  database: DatabaseClient;
  encryptionKey: string;
  logger?: { info: (payload: unknown, message?: string) => void; warn: (payload: unknown, message?: string) => void; error: (payload: unknown, message?: string) => void };
}

/**
 * Gerencia uma sessão do WhatsApp Web por conta usando Baileys.
 *
 * O usuário conecta lendo um QR Code no próprio celular (Aparelhos conectados),
 * sem precisar de conta Meta Business, token ou webhook.
 */
/** Logger silencioso compatível com a interface esperada pelo Baileys (pino-like). */
interface SocketLogger {
  level: string;
  child: (obj: Record<string, unknown>) => SocketLogger;
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

function createSilentLogger(): SocketLogger {
  const noop = () => undefined;
  return {
    level: 'silent',
    child: () => createSilentLogger(),
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

export class WhatsappSessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly store: WhatsappSessionStore;
  private readonly database: DatabaseClient;
  private readonly encryptionKey: string;
  private readonly logger: WhatsappSessionManagerOptions['logger'];

  constructor(options: WhatsappSessionManagerOptions) {
    this.database = options.database;
    this.encryptionKey = options.encryptionKey;
    this.logger = options.logger;
    this.store = new WhatsappSessionStore(options.database, options.encryptionKey);
  }

  getState(accountId: string): QrSessionState {
    return (
      this.sessions.get(accountId)?.state ?? {
        status: 'IDLE',
        qr: null,
        pairingCode: null,
        phoneNumber: null,
        error: null,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  isConnected(accountId: string): boolean {
    return this.getState(accountId).status === 'CONNECTED';
  }

  /** Inicia (ou reinicia) a sessão e devolve o estado atual (com QR, quando disponível). */
  async start(accountId: string): Promise<QrSessionState> {
    const existing = this.sessions.get(accountId);
    if (existing) {
      this.setState(accountId, { ...existing.state, status: 'CONNECTING', qr: null, error: null });
      try {
        existing.socket.end(undefined);
      } catch {
        // Ignora erros ao encerrar a sessão anterior
      }
      this.sessions.delete(accountId);
    }

    let stored: WhatsappSessionRow | null = null;
    try {
      stored = await this.store.load(accountId);
    } catch (error) {
      // Sem persistência a sessão ainda funciona, mas precisa ser escaneada novamente.
      this.logger?.warn({ err: error, accountId }, 'Sessão anterior não pôde ser carregada');
    }

    const creds: AuthenticationCreds = (stored?.creds as AuthenticationCreds | null) ?? initAuthCreds();
    const keys = this.store.createKeyStore(accountId, stored?.keys ?? {});
    const latest = await fetchLatestBaileysVersion();
    const version = latest.version;

    const socket = makeWASocket({
      version,
      auth: { creds, keys },
      logger: createSilentLogger(),
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      printQRInTerminal: false,
      connectTimeoutMs: 60_000,
      getMessage: () => Promise.resolve(undefined),
    });

    const state: QrSessionState = {
      status: 'CONNECTING',
      qr: null,
      pairingCode: null,
      phoneNumber: stored?.phoneNumber ?? null,
      error: null,
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(accountId, { socket, state });
    this.setState(accountId, state);

    socket.ev.on('creds.update', () => {
      void this.store.saveCredentials(accountId, socket.authState.creds).catch((error: unknown) => {
        this.logger?.error({ err: error, accountId }, 'Falha ao salvar credenciais da sessão');
      });
    });

    socket.ev.on('connection.update', (update) => {
      const pairingCode = (update as { pairingCode?: string }).pairingCode;

      if (update.qr) {
        this.setState(accountId, {
          ...this.getState(accountId),
          status: 'AWAITING_SCAN',
          qr: update.qr,
          error: null,
        });
      }

      if (pairingCode) {
        this.setState(accountId, {
          ...this.getState(accountId),
          status: 'AWAITING_SCAN',
          pairingCode,
        });
      }

      if (update.connection === 'open') {
        const phoneNumber = jidToPhone(socket.user?.id ?? undefined);
        this.setState(accountId, {
          ...this.getState(accountId),
          status: 'CONNECTED',
          qr: null,
          pairingCode: null,
          phoneNumber,
          error: null,
        });
        void this.store
          .updateStatus(accountId, 'CONNECTED', phoneNumber)
          .catch((error: unknown) => {
            this.logger?.error({ err: error, accountId }, 'Falha ao salvar status da sessão');
          });
      }

      if (update.connection === 'close') {
        const statusCode = (update.lastDisconnect as { error?: { output?: { statusCode?: number } } })
          ?.error?.output?.statusCode;

        this.setState(accountId, {
          ...this.getState(accountId),
          status: 'DISCONNECTED',
          qr: null,
          error:
            statusCode === DisconnectReason.loggedOut
              ? 'Sessão encerrada no celular. Escaneie o QR Code novamente.'
              : null,
        });

        void this.store
          .updateStatus(accountId, 'DISCONNECTED')
          .catch(() => undefined);
      }
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        if (message.key.fromMe) continue;

        const body = extractText(message.message);
        if (!body) continue;

        const fromPhone = jidToPhone(message.key.remoteJid);
        if (!fromPhone) continue;

        void new TenantStore(this.database, accountId)
          .receiveInboundMessage({
            fromPhone,
            body,
            externalId: message.key.id ?? undefined,
            provider: 'WHATSAPP_WEB',
          })
          .catch((error: unknown) => {
            this.logger?.error({ err: error, accountId }, 'Falha ao registrar mensagem recebida');
          });
      }
    });

    return this.getState(accountId);
  }

  /** Envia uma mensagem pelo WhatsApp Web. Retorna false quando não há sessão ativa. */
  async sendMessage(accountId: string, toPhone: string, body: string): Promise<boolean> {
    const runtime = this.sessions.get(accountId);
    if (!runtime || runtime.state.status !== 'CONNECTED') return false;

    try {
      await runtime.socket.sendMessage(phoneToJid(toPhone), {
        text: body,
      });
      return true;
    } catch (error) {
      this.logger?.error({ err: error, accountId }, 'Falha ao enviar mensagem pelo WhatsApp Web');
      return false;
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const runtime = this.sessions.get(accountId);
    if (runtime) {
      try {
        await runtime.socket.logout();
      } catch {
        // Ignora erros no logout
      }
      try {
        runtime.socket.end(undefined);
      } catch {
        // Ignora erros no encerramento
      }
      this.sessions.delete(accountId);
    }

    await this.store.clear(accountId);
    this.setState(accountId, {
      status: 'IDLE',
      qr: null,
      pairingCode: null,
      phoneNumber: null,
      error: null,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Restaura sessões já conectadas quando a API sobe. */
  async restoreSessions(): Promise<void> {
    try {
      const rows = await this.database.$queryRawUnsafe<{ accountId: string }[]>(
        `SELECT "accountId" FROM "whatsapp_sessions" WHERE "status" = 'CONNECTED'`,
      );

      for (const row of rows) {
        this.logger?.info({ accountId: row.accountId }, 'Restaurando sessão do WhatsApp');
        await this.start(row.accountId);
      }
    } catch (error) {
      this.logger?.warn({ err: error }, 'Não foi possível restaurar as sessões do WhatsApp');
    }
  }

  private setState(accountId: string, state: QrSessionState): void {
    const runtime = this.sessions.get(accountId);
    const next = { ...state, updatedAt: new Date().toISOString() };
    if (runtime) {
      runtime.state = next;
    } else {
      this.sessions.set(accountId, {
        socket: undefined as unknown as WASocket,
        state: next,
      });
    }
  }

  /** Converte o estado do Baileys em JSON serializável (usado em logs). */
  static describeState(state: QrSessionState): string {
    return JSON.stringify({ ...state, qr: state.qr ? 'presente' : null });
  }

  static stringifyForLog(value: unknown): string {
    return JSON.stringify(value, BufferJSON.replacer);
  }
}
