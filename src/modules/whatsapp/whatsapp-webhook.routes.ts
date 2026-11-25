import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError, UnauthorizedError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import type { QueueManager } from '../../shared/queues/queue-manager';
import { QUEUE_NAMES } from '../../shared/queues/queue-names';
import { genericWebhookPayloadSchema, metaWebhookQuerySchema } from './whatsapp.schemas';

export interface WhatsappWebhookRoutesOptions {
  database: DatabaseClient;
  queueManager?: QueueManager | undefined;
}

const accountIdParamsSchema = z.object({
  accountId: z.string().uuid(),
});

export function registerWhatsappWebhookRoutes(
  app: FastifyInstance,
  options: WhatsappWebhookRoutesOptions,
): void {
  // Verificação de webhook (Meta Cloud API Webhook handshake)
  app.get('/webhooks/whatsapp/:accountId', async (request, reply) => {
    const { accountId } = parseInput(accountIdParamsSchema, request.params);
    const query = parseInput(metaWebhookQuerySchema, request.query);

    const config = await options.database.whatsappConfig.findUnique({
      where: { accountId },
      select: { webhookSecretEncrypted: true },
    });

    if (!config) {
      throw new NotFoundError('Configuração do WhatsApp não encontrada para esta conta.');
    }

    if (query['hub.mode'] === 'subscribe') {
      if (query['hub.verify_token'] === config.webhookSecretEncrypted) {
        return reply.code(200).send(query['hub.challenge'] ?? 'OK');
      }
      throw new UnauthorizedError('Token de verificação incorreto.');
    }

    return reply.code(200).send({ status: 'active' });
  });

  // Recebimento de mensagens do WhatsApp
  app.post('/webhooks/whatsapp/:accountId', async (request, reply) => {
    const { accountId } = parseInput(accountIdParamsSchema, request.params);

    const account = await options.database.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundError('Conta não encontrada.');
    }

    const payload = parseInput(genericWebhookPayloadSchema, request.body);
    const store = new TenantStore(options.database, accountId);

    const result = await store.receiveInboundMessage({
      fromPhone: payload.fromPhone,
      body: payload.body,
      externalId: payload.externalId,
      provider: payload.provider,
    });

    if (result.ignored) {
      return reply.code(200).send({ status: 'ignored', reason: result.reason });
    }

    if (options.queueManager) {
      await options.queueManager.enqueue(QUEUE_NAMES.incomingMessages, 'process-inbound-message', {
        accountId,
        provider: payload.provider,
        externalMessageId: payload.externalId ?? result.message.id,
        fromPhone: payload.fromPhone,
        body: payload.body,
        receivedAt: result.message.sentAt.toISOString(),
      });
    }

    return reply.code(200).send({
      status: 'received',
      data: {
        conversationId: result.conversation.id,
        messageId: result.message.id,
      },
    });
  });
}
