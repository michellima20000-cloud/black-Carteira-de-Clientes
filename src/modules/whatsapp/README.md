# Módulo WhatsApp & Atendimento Humano

Implementado na **Fase 5**:

- **Conversas e Atendimento**:
  - `GET /conversations`: listagem paginada com filtros por status (`BOT`, `AGUARDANDO_HUMANO`, `EM_ATENDIMENTO`, `FINALIZADA`), atendente (`assignedUserId`), cliente e busca.
  - `GET /conversations/:id`: detalhes da conversa com cliente e responsável.
  - `GET /conversations/:id/messages`: histórico ordenado de mensagens.
  - `POST /conversations/:id/messages`: atendente envia mensagem (`OUTBOUND`), atualiza a conversa e enfileira em `outgoing-messages`.
  - `PATCH /conversations/:id/status`: transição de estado da conversa.
  - `PATCH /conversations/:id/assign`: atribuição ou transferência para atendente da conta.

- **Respostas Rápidas (`QuickReply`)**:
  - `GET /quick-replies`: listagem de respostas rápidas por tenant.
  - `POST /quick-replies`: cadastro com gatilho e texto.
  - `PATCH /quick-replies/:id`: edição.
  - `DELETE /quick-replies/:id`: exclusão (`OWNER` ou `ADMIN`).

- **Blocklist**:
  - `GET /blocklist`: números bloqueados da conta.
  - `POST /blocklist`: inclusão de telefone bloqueado com motivo.
  - `DELETE /blocklist/:id`: remoção da blocklist.

- **Webhooks**:
  - `GET /webhooks/whatsapp/:accountId`: handshake de validação do Meta Cloud API (`hub.challenge`).
  - `POST /webhooks/whatsapp/:accountId`: recebimento de mensagens inbound, idempotência por `externalId`, checagem de blocklist, criação/atualização de cliente e conversa e enfileiramento em `incoming-messages`.
