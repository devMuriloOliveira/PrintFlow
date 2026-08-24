# PrintFlow BackEnd

API HTTP do PrintFlow 3D. Ela centraliza autenticacao, isolamento por tenant, cadastros, fila de impressao, arquivos de impressao, marketplaces e comunicacao com o PrintFlow Agent.

## Para Que Serve

O BackEnd e o ponto confiavel do sistema. Ele:

- Autentica usuarios e controla sessoes.
- Resolve o tenant a partir do token autenticado.
- Persiste dados de produtos, pedidos, filamentos, impressoras, clientes, metas e configuracoes.
- Valida compatibilidade de produto/impressora antes da impressao.
- Cria comandos para o Agent executar localmente.
- Recebe heartbeat, status e resultado de comandos do Agent.
- Entrega arquivos de impressao ao Agent sem guardar o arquivo pesado no banco.

## Estrutura

- `src/server.js`: entrada do servidor HTTP.
- `src/config`: leitura e validacao de ambiente.
- `src/http`: helpers HTTP, CORS, JSON e resposta.
- `src/routes`: handlers das rotas da API.
- `src/repositories`: acesso a dados por recurso.
- `src/services`: regras de negocio compartilhadas, validacao e armazenamento de arquivos.
- `src/db`: conexao PostgreSQL, migracoes e scripts auxiliares.
- `test`: testes automatizados.

## Variaveis de Ambiente

Crie um `.env` local a partir de `.env.example`, quando existir, e preencha os valores reais somente no ambiente local ou no provedor de hospedagem.

```powershell
Copy-Item .env.example .env
```

Variaveis principais:

- `DATABASE_URL`: string privada de conexao PostgreSQL.
- `PORT`: porta HTTP da API.
- `AUTH_SECRET`: segredo forte para assinatura dos access tokens.
- `AUTH_TOKEN_TTL_SECONDS`: duracao do access token.
- `REFRESH_TOKEN_TTL_SECONDS`: duracao do refresh token.
- `DATA_ENCRYPTION_KEY`: chave privada para criptografia de dados sensiveis.
- `LEGACY_DATA_ENCRYPTION_KEYS`: chaves antigas usadas apenas para rotacao.
- `WEBHOOK_SHARED_SECRET`: segredo compartilhado para webhooks.
- `ALLOW_DEMO_TENANT`: habilita tenant demonstrativo apenas em ambiente local/teste.
- `RATE_LIMIT_WINDOW_MS`: janela do rate limit.
- `RATE_LIMIT_MAX_REQUESTS`: limite geral por janela.
- `RATE_LIMIT_AUTH_MAX_REQUESTS`: limite para rotas de autenticacao.
- `MAX_CONCURRENT_REQUESTS_PER_IP`: limite de concorrencia por IP.
- `PRINT_FILE_STORAGE_DIR`: diretorio local dos arquivos de impressao.
- `PRINT_FILE_MAX_BYTES`: tamanho maximo permitido para upload de arquivo de impressao.

Nao publique valores reais dessas variaveis.

## Rodar Localmente

```powershell
npm.cmd install
npm.cmd run dev
```

Por padrao, a API local usa a porta configurada em `PORT` ou `3333`.

Rodar migracoes:

```powershell
npm.cmd run migrate
```

Limpar dados demonstrativos em ambiente local:

```powershell
npm.cmd run clean:demo
```

## Testes

```powershell
npm.cmd test
```

## Rotas Principais

Autenticacao:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Dados do aplicativo:

- `GET /api/app-data`
- `GET /api/products`
- `POST /api/products`
- `GET /api/orders`
- `GET /api/expenses`
- `GET /api/filaments`
- `GET /api/printers`
- `GET /api/marketplaces`
- `GET /api/clients`
- `GET /api/goals`
- `GET /api/settings`

Agent:

- `POST /api/agents/pairing-code`: gera codigo de pareamento para o usuario logado.
- `POST /api/agents/pair`: pareia o Agent usando o codigo.
- `POST /api/agents/verify`: valida a credencial local do Agent.
- `POST /api/agents/heartbeat`: marca Agent online e atualiza metadados.
- `GET /api/agents`: lista Agents da conta.
- `POST /api/agents/:id/discover`: cria comando de descoberta.
- `POST /api/agents/:id/connect-printer`: cria comando de conexao.
- `POST /api/agents/:id/printer-status`: cria comando de status.
- `POST /api/agents/:id/printer-start`: cria comando para iniciar impressao.
- `POST /api/agents/:id/printer-pause`: cria comando de pausa.
- `POST /api/agents/:id/printer-resume`: cria comando de retomada.
- `POST /api/agents/:id/printer-cancel`: cria comando de cancelamento.
- `POST /api/agents/:id/printer-disconnect`: cria comando de desconexao.

## Arquivos de Impressao

Arquivos de impressao nao devem ser salvos diretamente no banco. O banco guarda metadados, como nome, formato, hash, tamanho e chave de armazenamento. O arquivo fica em storage local ou externo, conforme configuracao.

Antes de enviar um arquivo ao Agent, o BackEnd valida:

- formato aceito pelo protocolo da impressora;
- volume da impressora;
- dimensoes do produto;
- material/filamento;
- status de validacao do produto;
- vinculo correto entre fila, impressora e tenant.

## Isolamento e Seguranca

- Toda rota de negocio deve usar o tenant resolvido pelo token.
- Acesso cruzado entre tenants deve retornar como recurso inexistente quando aplicavel.
- Tabelas de dados do cliente devem ter `tenant_id`.
- Indices e chaves unicas de dados do cliente devem incluir `tenant_id`.
- Dados sensiveis devem ser criptografados ou protegidos por hash cego quando busca for necessaria.
- Segredos de Agent e comandos nao devem ser salvos nem logados em texto puro.
