import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../shared/db/prisma';
import { NotFoundError } from '../../shared/http/app-error';
import { parseInput } from '../../shared/http/validation';
import { decryptSecret, encryptSecret, generateWebhookSecret } from '../../shared/security/secret-box';
import { whatsappConfigBodySchema } from './whatsapp-config.schemas';

export interface WhatsappConfigRoutesOptions {
  database: DatabaseClient;
  apiBaseUrl: string;
  encryptionKey: string;
}

const GRAPH_API_VERSION = 'v21.0';

function maskSecret(value: string): string {
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

async function testMetaCredentials(input: {
  accessToken: string;
  phoneNumberId: string | undefined;
}): Promise<{ valid: boolean; detail: string }> {
  const endpoint = input.phoneNumberId
    ? `https://graph.facebook.com/${GRAPH_API_VERSION}/${input.phoneNumberId}`
    : `https://graph.facebook.com/${GRAPH_API_VERSION}/me`;

  const url = new URL(endpoint);
  url.searchParams.set('access_token', input.accessToken);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      display_name?: string;
      error?: { message?: string; code?: number };
    };

    if (!response.ok || payload.error) {
      return {
        valid: false,
        detail:
          payload.error?.message ??
          `A Meta recusou o token (HTTP ${response.status}). Verifique o access token e as permissões.`,
      };
    }

    return {
      valid: true,
      detail: input.phoneNumberId
        ? `Token válido para o Phone Number ID ${payload.id ?? input.phoneNumberId}.`
        : `Token válido${payload.display_name ? ` para ${payload.display_name}` : ''}.`,
    };
  } catch (error) {
    return {
      valid: false,
      detail:
        error instanceof Error
          ? `Não foi possível falar com a Meta: ${error.message}`
          : 'Não foi possível falar com a Meta.',
    };
  }
}

export function registerWhatsappConfigRoutes(
  app: FastifyInstance,
  options: WhatsappConfigRoutesOptions,
): void {
  const { database, apiBaseUrl, encryptionKey } = options;

  app.get('/whatsapp/config', { preHandler: app.authenticate }, async (request) => {
    const accountId = request.authContext!.accountId;
    const config = await database.whatsappConfig.findUnique({
      where: { accountId },
    });

    const webhookUrl = `${apiBaseUrl.replace(/\/$/, '')}/webhooks/whatsapp/${accountId}`;

    if (!config) {
      return {
        data: {
          connected: false,
          accountId,
          webhookUrl,
          phoneNumber: null,
          phoneNumberId: null,
          provider: null,
          accessTokenHint: null,
          webhookSecret: null,
          updatedAt: null,
        },
      };
    }

    const isOwnerOrAdmin = ['OWNER', 'ADMIN'].includes(request.authContext!.role);
    const accessToken = decryptSecret(config.accessTokenEncrypted, encryptionKey);
    const webhookSecret = decryptSecret(config.webhookSecretEncrypted, encryptionKey);

    return {
      data: {
        connected: true,
        accountId,
        webhookUrl,
        phoneNumber: config.phoneNumber,
        phoneNumberId: config.phoneNumberId,
        provider: config.provider,
        accessTokenHint: maskSecret(accessToken),
        webhookSecret: isOwnerOrAdmin ? webhookSecret : null,
        updatedAt: config.updatedAt.toISOString(),
      },
    };
  });

  app.put(
    '/whatsapp/config',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const accountId = request.authContext!.accountId;
      const input = parseInput(whatsappConfigBodySchema, request.body);

      const webhookSecret = input.webhookSecret ?? generateWebhookSecret();

      const encryptedAccessToken = encryptSecret(input.accessToken, encryptionKey);
      const encryptedWebhookSecret = encryptSecret(webhookSecret, encryptionKey);

      const saved = await database.whatsappConfig.upsert({
        where: { accountId },
        create: {
          accountId,
          phoneNumber: input.phoneNumber,
          phoneNumberId: input.phoneNumberId ?? null,
          provider: input.provider,
          accessTokenEncrypted: encryptedAccessToken,
          webhookSecretEncrypted: encryptedWebhookSecret,
        },
        update: {
          phoneNumber: input.phoneNumber,
          phoneNumberId: input.phoneNumberId ?? null,
          provider: input.provider,
          accessTokenEncrypted: encryptedAccessToken,
          webhookSecretEncrypted: encryptedWebhookSecret,
        },
      });

      return {
        data: {
          connected: true,
          accountId,
          webhookUrl: `${apiBaseUrl.replace(/\/$/, '')}/webhooks/whatsapp/${accountId}`,
          phoneNumber: saved.phoneNumber,
          phoneNumberId: saved.phoneNumberId,
          provider: saved.provider,
          accessTokenHint: maskSecret(input.accessToken),
          webhookSecret,
          updatedAt: saved.updatedAt.toISOString(),
        },
      };
    },
  );

  app.post(
    '/whatsapp/config/test',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request) => {
      const accountId = request.authContext!.accountId;
      const config = await database.whatsappConfig.findUnique({ where: { accountId } });

      if (!config) {
        throw new NotFoundError('WhatsApp ainda não foi conectado nesta conta.');
      }

      const accessToken = decryptSecret(config.accessTokenEncrypted, encryptionKey);
      const result = await testMetaCredentials({
        accessToken,
        phoneNumberId: config.phoneNumberId ?? undefined,
      });

      return {
        data: {
          valid: result.valid,
          detail: result.detail,
          testedAt: new Date().toISOString(),
        },
      };
    },
  );

  app.delete(
    '/whatsapp/config',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    async (request, reply) => {
      const accountId = request.authContext!.accountId;
      const existing = await database.whatsappConfig.findUnique({
        where: { accountId },
        select: { id: true },
      });

      if (!existing) {
        throw new NotFoundError('WhatsApp não está conectado nesta conta.');
      }

      await database.whatsappConfig.delete({ where: { accountId } });

      return reply.code(204).send();
    },
  );
}
