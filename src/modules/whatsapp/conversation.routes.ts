import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { TenantStore } from '../../shared/db/tenant-store';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import type { QueueManager } from '../../shared/queues/queue-manager';
import { QUEUE_NAMES } from '../../shared/queues/queue-names';
import {
  assignConversationSchema,
  conversationIdParamsSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendConversationMessageSchema,
  updateConversationStatusSchema,
} from './whatsapp.schemas';

export interface ConversationRoutesOptions {
  database: DatabaseClient;
  queueManager?: QueueManager | undefined;
  /** Envia a mensagem diretamente pelo WhatsApp Web (sessão QR) quando disponível. */
  directSender?: ((accountId: string, toPhone: string, body: string) => Promise<boolean>) | undefined;
}

export function registerConversationRoutes(
  app: FastifyInstance,
  options: ConversationRoutesOptions,
): void {
  app.get('/conversations', { preHandler: app.authenticate }, async (request) => {
    const query = parseInput(listConversationsQuerySchema, request.query);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const result = await store.listConversations(query);

    return {
      data: result.items,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      },
    };
  });

  app.get('/conversations/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(conversationIdParamsSchema, request.params);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const conversation = await store.findConversation(id);
    if (!conversation) throw new NotFoundError('Conversa não encontrada.');
    return { data: conversation };
  });

  app.get('/conversations/:id/messages', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(conversationIdParamsSchema, request.params);
    const query = parseInput(listMessagesQuerySchema, request.query);
    const store = new TenantStore(options.database, request.authContext!.accountId);
    const result = await store.listMessages(id, query.page, query.pageSize);

    return {
      data: result.items,
      meta: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      },
    };
  });

  app.post('/conversations/:id/messages', { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = parseInput(conversationIdParamsSchema, request.params);
    const input = parseInput(sendConversationMessageSchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);

    const { message, conversation } = await store.sendConversationMessage(
      id,
      input.body,
      request.authContext!.userId,
    );

    if (options.queueManager) {
      await options.queueManager.enqueue(QUEUE_NAMES.outgoingMessages, 'send-message', {
        accountId: request.authContext!.accountId,
        conversationId: conversation.id,
        messageId: message.id,
        toPhone: conversation.customer.phone,
        body: input.body,
      });
    } else if (options.directSender) {
      const delivered = await options.directSender(
        request.authContext!.accountId,
        conversation.customer.phone,
        input.body,
      );

      if (!delivered) {
        app.log.warn(
          { conversationId: conversation.id },
          'Não há sessão de WhatsApp Web ativa para enviar a mensagem',
        );
      }
    }

    return reply.code(201).send({ data: { message, conversation } });
  });

  app.patch('/conversations/:id/status', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(conversationIdParamsSchema, request.params);
    const input = parseInput(updateConversationStatusSchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);

    const conversation = await store.updateConversationStatus(
      id,
      input.status,
      input.assignedUserId,
      request.authContext!.userId,
    );
    if (!conversation) throw new NotFoundError('Conversa não encontrada.');
    return { data: conversation };
  });

  app.patch('/conversations/:id/assign', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(conversationIdParamsSchema, request.params);
    const input = parseInput(assignConversationSchema, request.body);
    const store = new TenantStore(options.database, request.authContext!.accountId);

    const conversation = await store.assignConversation(
      id,
      input.assignedUserId,
      request.authContext!.userId,
    );
    if (!conversation) throw new NotFoundError('Conversa não encontrada.');
    return { data: conversation };
  });
}
