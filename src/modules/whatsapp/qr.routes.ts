import type { FastifyInstance } from 'fastify';
import type { WhatsappSessionManager } from './qr-session.manager';

export interface WhatsappQrRoutesOptions {
  sessions: WhatsappSessionManager;
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
    const state = await sessions.start(request.authContext!.accountId);
    return { data: state };
  });

  app.post('/whatsapp/qr/refresh', { preHandler: app.authenticate }, async (request) => {
    const state = await sessions.start(request.authContext!.accountId);
    return { data: state };
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
