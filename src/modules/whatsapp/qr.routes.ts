import type { FastifyInstance } from 'fastify';
import { AppError } from '../../shared/http/app-error';
import type { WhatsappSessionManager } from './qr-session.manager';

export interface WhatsappQrRoutesOptions {
  sessions: WhatsappSessionManager;
}

function toFriendlyError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Não foi possível iniciar a sessão do WhatsApp.';
}

export function registerWhatsappQrRoutes(
  app: FastifyInstance,
  options: WhatsappQrRoutesOptions,
): void {
  const { sessions } = options;

  app.get('/whatsapp/qr', { preHandler: app.authenticate }, (request) => {
    return { data: sessions.getState(request.authContext!.accountId) };
  });

  app.post('/whatsapp/qr/start', { preHandler: app.authenticate }, async (request) => {
    try {
      const state = await sessions.start(request.authContext!.accountId);
      return { data: state };
    } catch (error) {
      app.log.error({ err: error }, 'Falha ao iniciar a sessão do WhatsApp');
      return {
        error: {
          code: 'WHATSAPP_QR_START_FAILED',
          message: toFriendlyError(error),
        },
      };
    }
  });

  app.post('/whatsapp/qr/refresh', { preHandler: app.authenticate }, async (request) => {
    try {
      const state = await sessions.start(request.authContext!.accountId);
      return { data: state };
    } catch (error) {
      app.log.error({ err: error }, 'Falha ao renovar a sessão do WhatsApp');
      return {
        error: {
          code: 'WHATSAPP_QR_REFRESH_FAILED',
          message: toFriendlyError(error),
        },
      };
    }
  });

  app.post(
    '/whatsapp/qr/disconnect',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      await sessions.disconnect(request.authContext!.accountId);
      return { data: sessions.getState(request.authContext!.accountId) };
    },
  );
}
