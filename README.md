# Black Carteira — API

API multi-tenant da Carteira de Clientes, construída em Node.js 20+, TypeScript, Fastify, Prisma/PostgreSQL, Redis e BullMQ.

## Funcionalidades Implementadas

- **Autenticação & Segurança**: Login JWT com refresh token rotativo, Argon2id, rate limiting, helmet, CORS e controle de papéis (`OWNER`, `ADMIN`, `AGENT`).
- **Multitenancy Estrito**: Isolamento total de dados no `TenantStore` a partir do token JWT.
- **Clientes & Vendas**: Cadastro completo, normalização de telefones com DDI, cálculo automático de `lastPurchaseAt` e consulta de inativos.
- **Importação CSV / Excel**: Prévia de importação antes da gravação com detecção automática de colunas, validação de linhas e detecção de duplicidades.
- **Metas Mensais & Painel**: Distribuição de metas em centavos exatos (`EQUAL` e `HISTORICAL`) e painel gerencial com percentual atingido.
- **Filas & Worker Assíncrono**: Processamento em segundo plano com BullMQ, retries exponenciais e Dead-Letter Queue (DLQ).
- **WhatsApp & Atendimento Humano**: Webhook Meta Cloud API, chat inbox com triagem e atribuição de atendentes, respostas rápidas e blocklist.
- **Reativação de Clientes**: Templates de mensagens com variáveis dinâmicas e disparos em lote com validação de templates aprovados.
- **LGPD & Auditoria**: Exportação de dados do titular em JSON, anonimização definitiva (direito ao esquecimento) e consulta paginada de logs de auditoria.
- **Observabilidade & Backup**: Endpoints de métricas de sistema, health check com latência de serviços e scripts de backup automatizados.

## Execução Local

```bash
cp .env.example .env
npm install
docker compose up -d postgres redis
npm run prisma:migrate:deploy
npm run prisma:seed
npm run dev
```

Worker em processo separado:

```bash
npm run dev:worker
```

## Testes e Validação

```bash
npm test                # Testes unitários (34 testes)
npm run lint            # Validação ESLint
npm run typecheck       # Verificação de tipos TypeScript
npm run build           # Build Prisma + compilação TS
npm run test:integration # Testes de integração (exige Docker/PostgreSQL)
```

## Backup e Restore

Consulte a documentação em [docs/backup.md](docs/backup.md) ou execute:

```bash
# Linux / macOS
./scripts/backup.sh

# Windows / PowerShell
.\scripts\backup.ps1
```
