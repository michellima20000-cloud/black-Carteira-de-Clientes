# Carteira de Clientes — Frontend

Frontend da **Fase 1** da Carteira de Clientes, construído com React, Vite e TypeScript.
Esta entrega implementa somente autenticação, escolha/confirmação de conta, renovação de
sessão e o shell protegido do painel.

> **Escopo da Fase 1:** CRUD de clientes, vendas, metas, filas e WhatsApp **não** fazem parte
> desta implementação e serão adicionados em fases posteriores.

## Funcionalidades entregues

- Tela de login responsiva com validação, carregamento e mensagens de erro.
- Consulta de saúde da API (`GET /health`) com indicador de disponibilidade.
- Seleção e confirmação da conta atual após o login.
- Estado vazio quando a sessão não possui uma conta vinculada.
- Shell do painel protegido por rota e renovação automática de sessão em respostas `401`.
- Persistência temporária da sessão e logout com `POST /auth/logout`.
- Layout mobile com navegação inferior e layout desktop com barra lateral.
- ESLint, Prettier, Vitest e React Testing Library.
- Dockerfile multi-stage com `node:20-alpine` e `nginx:alpine`.

## Pré-requisitos

- Node.js 20.19 ou superior (o projeto também foi validado no Node 26 local).
- npm 10 ou superior.
- API compatível com o contrato descrito em [Contrato da API](#contrato-da-api).

## Execução local

```bash
npm ci
cp .env.example .env
npm run dev
```

A aplicação fica disponível em `http://localhost:5173`. A URL da API é definida exclusivamente
por `VITE_API_URL`:

```env
VITE_API_URL=http://localhost:3000
```

Variáveis `VITE_*` são incorporatedidas durante o build. Alterá-las exige reiniciar o Vite ou
reconstruir a imagem Docker.

## Scripts

| Comando                | Descrição                                                  |
| ---------------------- | ---------------------------------------------------------- |
| `npm run dev`          | Inicia o servidor de desenvolvimento do Vite.              |
| `npm run build`        | Valida os tipos e gera os arquivos de produção em `dist/`. |
| `npm run preview`      | Serve localmente o build de produção.                      |
| `npm run typecheck`    | Executa a validação TypeScript sem gerar arquivos.         |
| `npm run lint`         | Executa o ESLint e falha também com avisos.                |
| `npm run format`       | Formata os arquivos com Prettier.                          |
| `npm run format:check` | Verifica a formatação sem alterar arquivos.                |
| `npm test`             | Executa uma vez os testes com Vitest.                      |
| `npm run test:watch`   | Executa os testes em modo interativo.                      |
| `npm run check`        | Executa tipos, lint, formatação e testes.                  |

## Contrato da API

O cliente usa `VITE_API_URL` como base e envia `credentials: 'include'` em todas as requisições,
para suportar cookies `HttpOnly` sem alterar o restante do fluxo.

| Método | Rota            | Uso                                           |
| ------ | --------------- | --------------------------------------------- |
| `POST` | `/auth/login`   | Autentica com e-mail e senha.                 |
| `POST` | `/auth/refresh` | Renova a sessão.                              |
| `GET`  | `/auth/me`      | Recupera o usuário e a conta da sessão atual. |
| `POST` | `/auth/logout`  | Encerra a sessão no servidor.                 |
| `GET`  | `/health`       | Verifica API, banco e Redis.                  |

A API deve responder com o envelope `{ "data": ... }`. O refresh atual usa temporariamente o
corpo `{ "refreshToken": "..." }`, conforme o contrato combinado com o backend em paralelo.

## Estratégia de tokens

A implementação reduz a exposição de credenciais no navegador:

- **Access token:** mantido somente na memória do módulo; nunca é gravado em `localStorage` ou
  `sessionStorage` e não sobrevive ao recarregamento da página.
- **Refresh token:** enquanto o backend o devolve no JSON, ele fica no `sessionStorage`, que é
  limitado à aba atual e removido ao encerrar a sessão.
- **Cookies:** todas as chamadas já usam `credentials: 'include'`. Quando o backend passar a
  emitir o refresh token em cookie `HttpOnly`, `Secure` e `SameSite`, a persistência no
  `sessionStorage` poderá ser removida.
- **Ponto de migração:** `requestTokenRefresh` em `src/api/authApi.ts` é o único lugar que envia
  o refresh token no corpo. Para usar cookie HttpOnly, altere essa função para fazer
  `POST /auth/refresh` sem body e remova `refreshToken` da resposta do login.
- **CORS:** o backend deve permitir a origem exata do frontend e o header `credentials`; não deve
  combinar `Access-Control-Allow-Origin: *` com credenciais.

O access token é anexado automaticamente às requisições autenticadas. Uma resposta `401` dispara
uma renovação e uma única repetição da requisição original.

## Docker

A imagem usa dois estágios: build com Node 20 e execução com Nginx.

```bash
docker build \
  --build-arg VITE_API_URL=https://api.exemplo.com \
  -t carteira-clientes-frontend .

docker run --rm \
  -p 8080:80 \
  -e API_PROXY_URL=http://api:3000 \
  carteira-clientes-frontend
```

- `VITE_API_URL` é argumentado **no build** e precisa ser a URL pública alcançável pelo navegador.
- `API_PROXY_URL` é configurado **na execução** e indica o destino interno de `GET /health`.
  Não inclua `/health` nessa variável.
- O Nginx usa fallback SPA (`try_files ... /index.html`) e encaminha `/health` para a API.
- Para publicar atrás do mesmo domínio, publique a API em uma rota compatível ou use um proxy
  externo; o template atual não move `/auth/*` para a API.

## Testes

```bash
npm test
```

Os testes cobrem o fluxo de login, seleção de conta, acesso ao painel, redirecionamento de
rota protegida, erro de credenciais, restauração de sessão, estado vazio e o transporte isolado
do refresh token.

## Estrutura principal

```text
src/
├── api/             # cliente HTTP, API de autenticação e armazenamento de tokens
├── auth/            # contexto e ciclo de vida da sessão
├── components/      # componentes compartilhados e shell do dashboard
├── pages/           # login, escolha de conta, dashboard e 404
├── routes/          # guardas de rota protegida e pública
├── styles/          # design system e responsividade
└── test/            # configuração e testes de integração
```

## Premissas e decisões da Fase 1

1. O contrato de login entrega **uma conta** em `data.account` (e também em `data.user.account`).
   A tela de contas usa essa conta como item atual; o modelo já aceita um array `accounts` para
   uma futura API de seleção, mas nenhum endpoint adicional foi inventado nesta fase.
2. Após o login, `GET /auth/me` valida a sessão antes de abrir a escolha de conta.
3. A tela de seleção apenas confirma a conta retornada pelo login; não há troca entre várias
   organizações porque esse endpoint não faz parte do contrato atual.
4. O painel apresenta somente dados reais de sessão e conta. Nenhum dado, métrica ou fluxo de
   negócio futuro foi simulado.
5. `POST /auth/logout` recebe o refresh token no corpo conforme o contrato atual. A falha de rede
   no logout não impede a limpeza local dos tokens.
