# Arquitetura — Black Carteira

API multi-tenant construída com Node.js 20+, TypeScript, Fastify, Prisma, PostgreSQL, Redis e BullMQ.

## Processos

- **API**: Servidor Fastify responsável por autenticação JWT, validação rigorosa (Zod), isolamento multi-tenant (`TenantStore`), webhooks e endpoints REST.
- **Worker**: Processo Node.js independente que consome as filas BullMQ (`incoming-messages`, `outgoing-messages`, `imports`, `goal-recalc`, `inactive-scan`) e gerencia dead-letter (`dead-letter`) com retries exponenciais e isolamento por conta.
- **PostgreSQL**: Fonte de verdade com esquema relacional multi-tenant e índices otimizados para alta performance.
- **Redis**: Suporte a health checks, rate limiting distribuído e infraestrutura do BullMQ.

## Isolamento Multi-tenant

O access token contém `sub` (usuário), `accountId` e `role` (`OWNER`, `ADMIN`, `AGENT`), assinados via JWT HS256. O middleware `authenticate` valida a assinatura e injeta `request.authContext`.

Nenhuma rota de negócio aceita `accountId` vindo do corpo ou query: todas as consultas passam pelo `TenantStore`, garantindo que um tenant nunca acesse ou confirme a existência de dados de outro (retorno `404 Not Found`).

## Roadmap de Implementação

1. **Fase 1 — Base, autenticação e isolamento**: Login JWT, refresh token rotativo, hash Argon2id, Docker Compose, seed e teste automatizado de isolamento.
2. **Fase 2 — Clientes, vendas e importação**: CRUD de clientes e vendas, normalização de telefone brasileiro (DDI 55), detecção e parsing de planilhas CSV/XLSX com prévia de importação e filtro de clientes inativos.
3. **Fase 3 — Metas mensais e distribuição**: Metas distribuídas em centavos exatos nos modos `EQUAL` e `HISTORICAL`, cálculo de realizado e painel gerencial do mês.
4. **Fase 4 — BullMQ, worker e dead-letter**: Filas tipadas de domínio, políticas de retries com backoff exponencial, dead-letter queue (DLQ) com reprocessamento e métricas de fila.
5. **Fase 5 — WhatsApp e atendimento humano**: Webhook Meta Cloud API com handshake, mensagens inbound idempotentes, mensagens outbound enfileiradas, chat inbox com status de atendimento, respostas rápidas e blocklist.
6. **Fase 6 — Reativação e templates aprovados**: Templates de mensagem com interpolação de variáveis dinâmicas (`{{nome}}`, `{{dias_inativo}}`, etc.), campanhas de reativação com validação obrigatória de status aprovado (`APPROVED`) e filtro de blocklist.
7. **Fase 7 — Segurança, LGPD, observabilidade e backup**: Exportação e anonimização de dados do titular (LGPD), trilha de auditoria (`AuditLog`), métricas de processo/sistema e scripts de backup com política de retenção.
