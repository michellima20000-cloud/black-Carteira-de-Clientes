import type { AuthenticationCreds, WASocket } from '@whiskeysockets/baileys';
import type { DatabaseClient } from '../../shared/db/prisma';
import { AppError } from '../../shared/http/app-error';
import { TenantStore } from '../../shared/db/tenant-store';
import { WhatsappSessionStore, type WhatsappSessionRow } from './qr-session.store';

/**
 * O Baileys é carregado sob demanda (import dinâmico) para que uma falha
 * pontual na biblioteca nunca impeça a API de subir — o QR Code apenas
 * responde com uma mensagem de erro amigável nesse caso.
 */
type BaileysModule = Awaited<ReturnType<typeof importBaileys>>;

async function importBaileys(): Promise<
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  typeof import('@whiskeysockets/baileys')
> {
  return import('@whiskeysockets/baileys');
}

let baileysModule: BaileysModule | null = null;

async function loadBaileys(): Promise<BaileysModule> {
  if (!baileysModule) {
    baileysModule = await importBaileys();
  }
  return baileysModule;
}

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
  /** Indica se a sessão está sendo persistida no banco (ok = persistente). */
  storage: 'ok' | 'unavailable';
  updatedAt: string;
}

interface SessionRuntime {
  socket: WASocket;
  state: QrSessionState;
  creds: AuthenticationCreds;
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

function describeError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível iniciar a sessão do WhatsApp.';
}

export interface WhatsappSessionManagerOptions {
  database: DatabaseClient;
  encryptionKey: string;
  logger?: {
    info: (payload: unknown, message?: string) => void;
    warn: (payload: unknown, message?: string) => void;
    error: (payload: unknown, message?: string) => void;
  };
}

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

/**
 * Gerencia uma sessão do WhatsApp Web por conta usando Baileys.
 *
 * O usuário conecta lendo um QR Code no próprio celular (Aparelhos conectados),
 * sem precisar de conta Meta Business, token ou webhook.
 */
export class WhatsappSessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly states = new Map<string, QrSessionState>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly disconnecting = new Set<string>();
  private storageAvailable = true;
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
      this.sessions.get(accountId)?.state ??
      this.states.get(accountId) ?? {
        status: 'IDLE',
        qr: null,
        pairingCode: null,
        phoneNumber: null,
        error: null,
        storage: this.storageAvailable ? 'ok' : 'unavailable',
        updatedAt: new Date().toISOString(),
      }
    );
  }

  isConnected(accountId: string): boolean {
    return this.getState(accountId).status === 'CONNECTED';
  }

  /**
   * Inicia a sessão e devolve o estado atual (com QR, quando disponível).
   *
   * Por padrão NÃO reinicia uma sessão já ativa: reiniciar invalidaria o QR
   * Code que o usuário está escaneando naquele momento. Use `force: true`
   * apenas para gerar um QR novo.
   */
  async start(
    accountId: string,
    options: { force?: boolean; creds?: AuthenticationCreds } = {},
  ): Promise<QrSessionState> {
    try {
      return await this.openSession(accountId, options);
    } catch (error) {
      const message = describeError(error);
      this.logger?.error({ err: error, accountId }, 'Falha ao iniciar a sessão do WhatsApp');
      this.setState(accountId, {
        status: 'ERROR',
        qr: null,
        pairingCode: null,
        phoneNumber: this.getState(accountId).phoneNumber,
        error: message,
        storage: this.storageAvailable ? 'ok' : 'unavailable',
        updatedAt: new Date().toISOString(),
      });
      throw new AppError(500, 'WHATSAPP_QR_START_FAILED', message);
    }
  }

  private async openSession(
    accountId: string,
    options: { force?: boolean; creds?: AuthenticationCreds },
  ): Promise<QrSessionState> {
    const existing = this.sessions.get(accountId);

    if (existing && !options.force) {
      const active = ['CONNECTING', 'AWAITING_SCAN', 'CONNECTED'].includes(existing.state.status);
      if (active) {
        return this.getState(accountId);
      }
    }

    if (existing) {
      this.clearReconnectTimer(accountId);
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
      this.storageAvailable = true;
    } catch (error) {
      // Sem persistência a sessão ainda funciona, mas precisa ser escaneada novamente.
      this.storageAvailable = false;
      this.logger?.warn({ err: error, accountId }, 'Sessão anterior não pôde ser carregada');
    }

    const baileys = await loadBaileys();
    const creds: AuthenticationCreds =
      options.creds ??
      (stored?.creds as AuthenticationCreds | null) ??
      baileys.initAuthCreds();
    const keys = this.store.createKeyStore(accountId, stored?.keys ?? {}, {
      convertAppStateSyncKey: (value) =>
        baileys.proto.Message.AppStateSyncKeyData.fromObject(
          value as Parameters<typeof baileys.proto.Message.AppStateSyncKeyData.fromObject>[0],
        ),
    });

    // Se a consulta da versão mais recente falhar, usa uma versão estável conhecida.
    const latest = await baileys.fetchLatestBaileysVersion().catch(() => null);
    const version = latest?.version ?? ([2, 3000, 1029133823] as [number, number, number]);

    const socket = baileys.makeWASocket({
      version,
      auth: { creds, keys },
      logger: createSilentLogger(),
      browser: baileys.Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      printQRInTerminal: false,
      connectTimeoutMs: 60_000,
      retryRequestDelayMs: 500,
      getMessage: () => Promise.resolve(undefined),
    });

    const state: QrSessionState = {
      status: 'CONNECTING',
      qr: null,
      pairingCode: null,
      phoneNumber: stored?.phoneNumber ?? null,
      error: null,
      storage: this.storageAvailable ? 'ok' : 'unavailable',
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(accountId, { socket, state, creds });
    this.setState(accountId, state);

    socket.ev.on('creds.update', () => {
      const currentCreds = socket.authState.creds;
      const runtime = this.sessions.get(accountId);
      if (runtime) runtime.creds = currentCreds;

      const phoneNumber = jidToPhone(currentCreds.me?.id);
      if (phoneNumber) {
        this.setState(accountId, { ...this.getState(accountId), phoneNumber });
      }

      void this.store.saveCredentials(accountId, currentCreds).catch((error: unknown) => {
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
        const phoneNumber = jidToPhone(socket.user?.id ?? socket.authState.creds.me?.id);
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
        // Desconexão solicitada pelo usuário: não é erro.
        if (this.disconnecting.has(accountId)) {
          this.sessions.delete(accountId);
          return;
        }

        const disconnect = update.lastDisconnect as
          | { error?: { output?: { statusCode?: number }; message?: string } }
          | undefined;
        const statusCode = disconnect?.error?.output?.statusCode;
        const reason = disconnect?.error?.message;
        const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
        const restartRequired = statusCode === baileys.DisconnectReason.restartRequired;

        const errorMessage = loggedOut
          ? 'Sessão encerrada no celular. Escaneie o QR Code novamente.'
          : restartRequired
            ? 'O WhatsApp pediu para reiniciar a conexão. Reconectando automaticamente...'
            : `Conexão com o WhatsApp caiu (código ${statusCode ?? 'desconhecido'})${
                reason ? `: ${reason}` : '. Reconectando automaticamente...'
              }`;

        this.setState(accountId, {
          ...this.getState(accountId),
          status: 'DISCONNECTED',
          qr: null,
          error: errorMessage,
        });

        this.logger?.error({ accountId, statusCode, reason }, 'Sessão do WhatsApp encerrada');

        void this.store
          .updateStatus(accountId, 'DISCONNECTED')
          .catch(() => undefined);

        if (loggedOut) {
          // Sessão encerrada no celular: limpa as credenciais para o próximo
          // QR Code começar de um pareamento totalmente novo.
          void this.store.clear(accountId).catch(() => undefined);
          this.sessions.delete(accountId);
        } else {
          // 515 (restart required) e demais quedas: recria o socket mantendo
          // as credenciais — o pareamento é preservado e volta sozinho.
          this.scheduleReconnect(accountId, restartRequired ? 1_500 : 5_000);
        }
      }
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        if (message.key.fromMe) continue;

        const body = extractText(message.message);
        if (!body) continue;

        const remoteJid = message.key.remoteJid ?? '';
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
          continue;
        }

        const fromPhone = jidToPhone(remoteJid);
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

  /** Reconecta automaticamente após uma queda inesperada de conexão. */
  private scheduleReconnect(accountId: string, delayMs = 5_000): void {
    this.clearReconnectTimer(accountId);

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(accountId);
      const runtime = this.sessions.get(accountId);
      const reconnect = runtime?.creds
        ? { force: true, creds: runtime.creds }
        : { force: true };
      void this.start(accountId, reconnect).catch((error: unknown) => {
        this.logger?.warn({ err: error, accountId }, 'Falha ao reconectar o WhatsApp');
      });
    }, delayMs);

    timer.unref?.();
    this.reconnectTimers.set(accountId, timer);
  }

  private clearReconnectTimer(accountId: string): void {
    const timer = this.reconnectTimers.get(accountId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(accountId);
    }
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
    this.clearReconnectTimer(accountId);
    this.disconnecting.add(accountId);

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

    await this.store.clear(accountId).catch(() => undefined);
    this.setState(accountId, {
      status: 'IDLE',
      qr: null,
      pairingCode: null,
      phoneNumber: null,
      error: null,
      storage: this.storageAvailable ? 'ok' : 'unavailable',
      updatedAt: new Date().toISOString(),
    });

    this.disconnecting.delete(accountId);
  }

  /** Restaura sessões já conectadas quando a API sobe. */
  async restoreSessions(): Promise<void> {
    try {
      const rows = await this.database.$queryRawUnsafe<{ accountId: string }[]>(
        `SELECT "accountId" FROM "whatsapp_sessions" WHERE "status" = 'CONNECTED'`,
      );

      this.storageAvailable = true;

      for (const row of rows) {
        this.logger?.info({ accountId: row.accountId }, 'Restaurando sessão do WhatsApp');
        await this.start(row.accountId);
      }
    } catch (error) {
      this.storageAvailable = false;
      this.logger?.warn({ err: error }, 'Não foi possível restaurar as sessões do WhatsApp');
    }
  }

  private setState(accountId: string, state: QrSessionState): void {
    const next = { ...state, updatedAt: new Date().toISOString() };
    const runtime = this.sessions.get(accountId);

    if (runtime) {
      runtime.state = next;
    } else {
      this.states.set(accountId, next);
    }
  }

  /** Converte o estado do Baileys em JSON serializável (usado em logs). */
  static describeState(state: QrSessionState): string {
    return JSON.stringify({ ...state, qr: state.qr ? 'presente' : null });
  }
}
