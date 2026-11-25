import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app';
import type { AppConfig } from '../../src/shared/config/env';
import { createDatabaseClient, type DatabaseClient } from '../../src/shared/db/prisma';

const integrationEnabled = process.env.RUN_INTEGRATION === 'true';

interface TestContext {
  app: FastifyInstance;
  database: DatabaseClient;
  accountAId: string;
  accountBId: string;
  userAId: string;
  userBId: string;
  customerAId: string;
  customerBId: string;
  password: string;
}

const redis = {
  ping: (): Promise<string> => Promise.resolve('PONG'),
};

function testConfig(databaseUrl: string): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    databaseUrl,
    redisUrl: 'redis://localhost:6379',
    jwt: {
      accessSecret: 'access-secret-for-tests-with-at-least-32-characters',
      refreshSecret: 'refresh-secret-for-tests-with-at-least-32-characters',
      issuer: 'black-carteira-test',
      audience: 'black-carteira-panel-test',
      accessTtlSeconds: 900,
      refreshTtlDays: 7,
    },
    corsOrigins: ['http://localhost:5173'],
    cookie: {
      name: 'refresh_token',
      secure: false,
      sameSite: 'lax',
      domain: undefined,
    },
    rateLimit: { max: 1_000, timeWindow: '1 minute' },
    loginRateLimit: { max: 100, timeWindow: '1 minute' },
    apiBaseUrl: 'http://localhost:3000',
  };
}

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });

  expect(response.statusCode).toBe(200);
  return response.json().data.accessToken as string;
}

describe.runIf(integrationEnabled)('isolamento entre contas', () => {
  let context: TestContext;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
    }

    const database = createDatabaseClient(databaseUrl);
    const password = 'Senha-Forte-123!';
    const passwordHash = await argon2.hash(password);
    const suffix = randomUUID();
    const accountAId = randomUUID();
    const accountBId = randomUUID();
    const userAId = randomUUID();
    const userBId = randomUUID();

    await database.account.createMany({
      data: [
        { id: accountAId, slug: `conta-a-${suffix}`, name: 'Conta A' },
        { id: accountBId, slug: `conta-b-${suffix}`, name: 'Conta B' },
      ],
    });

    await database.user.createMany({
      data: [
        {
          id: userAId,
          accountId: accountAId,
          name: 'Usuário A',
          email: `a-${suffix}@example.test`,
          passwordHash,
          role: 'OWNER',
        },
        {
          id: userBId,
          accountId: accountBId,
          name: 'Usuário B',
          email: `b-${suffix}@example.test`,
          passwordHash,
          role: 'OWNER',
        },
      ],
    });

    const customerA = await database.customer.create({
      data: { accountId: accountAId, name: 'Cliente A', phone: `5511${suffix.slice(0, 8)}` },
    });
    const customerB = await database.customer.create({
      data: { accountId: accountBId, name: 'Cliente B', phone: `5522${suffix.slice(0, 8)}` },
    });

    const app = await buildApp({
      config: testConfig(databaseUrl),
      database,
      redis,
      logger: false,
    });
    await app.ready();

    context = {
      app,
      database,
      accountAId,
      accountBId,
      userAId,
      userBId,
      customerAId: customerA.id,
      customerBId: customerB.id,
      password,
    };
  }, 30_000);

  afterAll(async () => {
    if (!context) return;
    await context.app.close();
    await context.database.customer.deleteMany({
      where: { accountId: { in: [context.accountAId, context.accountBId] } },
    });
    await context.database.user.deleteMany({
      where: { accountId: { in: [context.accountAId, context.accountBId] } },
    });
    await context.database.account.deleteMany({
      where: { id: { in: [context.accountAId, context.accountBId] } },
    });
    await context.database.$disconnect();
  });

  it('não permite ler, editar ou apagar dados de outra conta', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const tokenA = await login(context.app, emailA, context.password);
    const authorization = { authorization: `Bearer ${tokenA}` };

    const list = await context.app.inject({
      method: 'GET',
      url: '/customers',
      headers: authorization,
    });
    expect(list.statusCode).toBe(200);
    const customerIds = list.json().data.map((customer: { id: string }) => customer.id);
    expect(customerIds).toContain(context.customerAId);
    expect(customerIds).not.toContain(context.customerBId);

    const read = await context.app.inject({
      method: 'GET',
      url: `/customers/${context.customerBId}`,
      headers: authorization,
    });
    expect(read.statusCode).toBe(404);

    const update = await context.app.inject({
      method: 'PATCH',
      url: `/customers/${context.customerBId}`,
      headers: authorization,
      payload: { name: 'Invadido' },
    });
    expect(update.statusCode).toBe(404);

    const remove = await context.app.inject({
      method: 'DELETE',
      url: `/customers/${context.customerBId}`,
      headers: authorization,
    });
    expect(remove.statusCode).toBe(404);

    const customerB = await context.database.customer.findUnique({
      where: { id: context.customerBId },
    });
    expect(customerB?.name).toBe('Cliente B');
  });

  it('não permite atribuir um responsável de outra conta', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const tokenA = await login(context.app, emailA, context.password);

    const response = await context.app.inject({
      method: 'PATCH',
      url: `/customers/${context.customerAId}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { ownerId: context.userBId },
    });

    expect(response.statusCode).toBe(404);
    const customerA = await context.database.customer.findUniqueOrThrow({
      where: { id: context.customerAId },
    });
    expect(customerA.ownerId).toBeNull();
  });

  it('faz rotação do refresh token e invalida o token anterior', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const loginResponse = await context.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: emailA, password: context.password },
    });
    const firstRefreshToken = loginResponse.json().data.refreshToken as string;

    const firstRefresh = await context.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: firstRefreshToken },
    });
    expect(firstRefresh.statusCode).toBe(200);
    expect(firstRefresh.json().data.refreshToken).not.toBe(firstRefreshToken);

    const reusedRefresh = await context.app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: firstRefreshToken },
    });
    expect(reusedRefresh.statusCode).toBe(401);
  });

  it('isola vendas, criação de clientes e lista de inativos entre contas', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const tokenA = await login(context.app, emailA, context.password);
    const authorization = { authorization: `Bearer ${tokenA}` };

    const createSaleForB = await context.app.inject({
      method: 'POST',
      url: '/sales',
      headers: authorization,
      payload: {
        customerId: context.customerBId,
        soldAt: '2026-11-10',
        amount: 250.5,
      },
    });
    expect(createSaleForB.statusCode).toBe(404);

    const createSaleForA = await context.app.inject({
      method: 'POST',
      url: '/sales',
      headers: authorization,
      payload: {
        customerId: context.customerAId,
        soldAt: '2026-11-10',
        amount: 250.5,
        observation: 'Pedido teste',
      },
    });
    expect(createSaleForA.statusCode).toBe(201);
    const saleId = createSaleForA.json().data.id as string;

    const inactive = await context.app.inject({
      method: 'GET',
      url: '/customers/inactive?days=30',
      headers: authorization,
    });
    expect(inactive.statusCode).toBe(200);
    const inactiveIds = inactive.json().data.map((customer: { id: string }) => customer.id);
    expect(inactiveIds).not.toContain(context.customerBId);

    const deleteSale = await context.app.inject({
      method: 'DELETE',
      url: `/sales/${saleId}`,
      headers: authorization,
    });
    expect(deleteSale.statusCode).toBe(204);
  });

  it('isola metas mensais e painel do mês entre contas', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const emailB = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userBId },
      })
    ).email;
    const tokenA = await login(context.app, emailA, context.password);
    const tokenB = await login(context.app, emailB, context.password);

    const crossCustomerGoal = await context.app.inject({
      method: 'PUT',
      url: '/goals',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        month: '2026-11',
        totalAmount: 1000,
        distributionMode: 'EQUAL',
        customerIds: [context.customerBId],
      },
    });
    expect(crossCustomerGoal.statusCode).toBe(404);

    const createGoalA = await context.app.inject({
      method: 'PUT',
      url: '/goals',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        month: '2026-11',
        totalAmount: 1000,
        distributionMode: 'EQUAL',
      },
    });
    expect(createGoalA.statusCode).toBe(200);
    const goalAId = createGoalA.json().data.goal.id as string;

    const dashboardB = await context.app.inject({
      method: 'GET',
      url: '/goals/dashboard?month=2026-11',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(dashboardB.statusCode).toBe(200);
    expect(dashboardB.json().data.goal).toBeNull();

    const deleteGoalByB = await context.app.inject({
      method: 'DELETE',
      url: `/goals/${goalAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(deleteGoalByB.statusCode).toBe(404);

    const deleteGoalByA = await context.app.inject({
      method: 'DELETE',
      url: `/goals/${goalAId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(deleteGoalByA.statusCode).toBe(204);
  });

  it('isola conversas, mensagens e respostas rápidas entre contas', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const emailB = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userBId },
      })
    ).email;
    const tokenA = await login(context.app, emailA, context.password);
    const tokenB = await login(context.app, emailB, context.password);

    // Cria resposta rápida na Conta A
    const qrA = await context.app.inject({
      method: 'POST',
      url: '/quick-replies',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Promoção', text: 'Temos 10% de desconto hoje!' },
    });
    expect(qrA.statusCode).toBe(201);
    const qrAId = qrA.json().data.id as string;

    // Conta B não vê e não consegue apagar resposta rápida da Conta A
    const listQrB = await context.app.inject({
      method: 'GET',
      url: '/quick-replies',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listQrB.statusCode).toBe(200);
    const qrBIds = listQrB.json().data.map((item: { id: string }) => item.id);
    expect(qrBIds).not.toContain(qrAId);

    const deleteQrByB = await context.app.inject({
      method: 'DELETE',
      url: `/quick-replies/${qrAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(deleteQrByB.statusCode).toBe(404);

    // Cria conversa para Cliente A diretamente no banco
    const convA = await context.database.conversation.create({
      data: {
        accountId: context.accountAId,
        customerId: context.customerAId,
        status: 'AGUARDANDO_HUMANO',
      },
    });

    // Conta B não consegue ver a conversa da Conta A
    const getConvByB = await context.app.inject({
      method: 'GET',
      url: `/conversations/${convA.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getConvByB.statusCode).toBe(404);

    // Atendente da Conta A envia mensagem
    const sendMessageA = await context.app.inject({
      method: 'POST',
      url: `/conversations/${convA.id}/messages`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { body: 'Olá, sou o atendente da Conta A!' },
    });
    expect(sendMessageA.statusCode).toBe(201);
    expect(sendMessageA.json().data.conversation.status).toBe('EM_ATENDIMENTO');

    // Limpeza
    await context.database.message.deleteMany({ where: { conversationId: convA.id } });
    await context.database.conversation.deleteMany({ where: { id: convA.id } });
    await context.database.quickReply.deleteMany({ where: { id: qrAId } });
  });

  it('isola templates de mensagem e valida política de aprovação para reativação', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const emailB = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userBId },
      })
    ).email;
    const tokenA = await login(context.app, emailA, context.password);
    const tokenB = await login(context.app, emailB, context.password);

    // Conta A cria template
    const createTplA = await context.app.inject({
      method: 'POST',
      url: '/templates',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Template Reativação Alfa',
        content: 'Olá {{primeiro_nome}}, volte a comprar conosco!',
        status: 'DRAFT',
      },
    });
    expect(createTplA.statusCode).toBe(201);
    const tplAId = createTplA.json().data.id as string;

    // Conta B não consegue ver nem apagar template da Conta A
    const getTplByB = await context.app.inject({
      method: 'GET',
      url: `/templates/${tplAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getTplByB.statusCode).toBe(404);

    const deleteTplByB = await context.app.inject({
      method: 'DELETE',
      url: `/templates/${tplAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(deleteTplByB.statusCode).toBe(404);

    // Tentativa de disparo com template DRAFT é rejeitada
    const dispatchDraft = await context.app.inject({
      method: 'POST',
      url: '/reactivations/dispatch',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        templateId: tplAId,
        inactiveDays: 30,
        includeNeverPurchased: 'true',
      },
    });
    expect(dispatchDraft.statusCode).toBe(400);

    // Aprova o template e testa prévia
    await context.app.inject({
      method: 'PATCH',
      url: `/templates/${tplAId}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { status: 'APPROVED' },
    });

    const preview = await context.app.inject({
      method: 'POST',
      url: '/reactivations/preview',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        templateId: tplAId,
        inactiveDays: 30,
        includeNeverPurchased: 'true',
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.template.status).toBe('APPROVED');

    // Limpeza
    await context.database.messageTemplate.deleteMany({ where: { id: tplAId } });
  });

  it('isola exportação e anonimização LGPD e logs de auditoria entre contas', async () => {
    const emailA = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userAId },
      })
    ).email;
    const emailB = (
      await context.database.user.findUniqueOrThrow({
        where: { id: context.userBId },
      })
    ).email;
    const tokenA = await login(context.app, emailA, context.password);
    const tokenB = await login(context.app, emailB, context.password);

    // Conta B não consegue exportar nem anonimizar cliente da Conta A
    const exportByB = await context.app.inject({
      method: 'GET',
      url: `/lgpd/customers/${context.customerAId}/export`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(exportByB.statusCode).toBe(404);

    const anonymizeByB = await context.app.inject({
      method: 'POST',
      url: `/lgpd/customers/${context.customerAId}/anonymize`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { reason: 'Tentativa indevida' },
    });
    expect(anonymizeByB.statusCode).toBe(404);

    // Conta A exporta seus próprios dados com sucesso
    const exportByA = await context.app.inject({
      method: 'GET',
      url: `/lgpd/customers/${context.customerAId}/export`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(exportByA.statusCode).toBe(200);
    expect(exportByA.json().data.customer.id).toBe(context.customerAId);

    // Conta B consulta logs de auditoria e não vê ações da Conta A
    const auditLogsB = await context.app.inject({
      method: 'GET',
      url: '/audit-logs',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(auditLogsB.statusCode).toBe(200);
    const auditActorIds = auditLogsB.json().data.map((log: { actor?: { id: string } }) => log.actor?.id);
    expect(auditActorIds).not.toContain(context.userAId);

    // Endpoint de métricas de observabilidade funciona para OWNER
    const metricsA = await context.app.inject({
      method: 'GET',
      url: '/system/metrics',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(metricsA.statusCode).toBe(200);
    expect(metricsA.json().data.memory).toBeDefined();
  });
});
