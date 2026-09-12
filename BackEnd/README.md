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
- `RATE_LIMIT_SHARED`: use `true` em ambientes com mais de uma instancia; usa a tabela `api_rate_limits` no PostgreSQL para compartilhar a janela entre processos.
- `MAX_CONCURRENT_REQUESTS_PER_IP`: limite de concorrencia por IP.
- `PRINT_QUEUE_WATCHDOG_INTERVAL_MS`: frequencia de verificacao de comandos de impressao pendentes.
- `AGENT_OFFLINE_AFTER_MS`: tempo sem heartbeat para considerar o Agent indisponivel.
- `AGENT_HEALTH_WATCHDOG_INTERVAL_MS`: frequencia de verificacao da saude dos Agents.
- `SUBSCRIPTION_WATCHDOG_INTERVAL_MS`: frequencia de verificacao de prazos das assinaturas.
- `SUBSCRIPTION_WARNING_MS`: antecedencia dos avisos de vencimento da assinatura.
- `STRIPE_SECRET_KEY`: chave privada live/teste, configurada somente no ambiente de deploy.
- `STRIPE_WEBHOOK_SECRET`: segredo `whsec_...` do endpoint Stripe, configurado depois de criar o webhook.
- `EXPENSE_RECURRING_INTERVAL_MS`: intervalo da geração automática de despesas recorrentes vencidas.
- `PRINT_FILE_STORAGE_DIR`: diretorio local dos arquivos de impressao.
- `PRINT_FILE_MAX_BYTES`: tamanho maximo permitido para upload de arquivo de impressao.
- `MERCADO_LIVRE_CLIENT_ID`: App ID privado da aplicacao Mercado Livre.
- `MERCADO_LIVRE_CLIENT_SECRET`: Secret Key privada da aplicacao Mercado Livre.
- `MERCADO_LIVRE_REDIRECT_URI`: callback fixa registrada no Mercado Livre.
- `APP_PUBLIC_URL`: URL publica do FrontEnd usada ao finalizar OAuth e retornar do checkout.
- `CORS_ALLOWED_ORIGINS`: origens HTTPS autorizadas (FrontEnd e AdminFrontEnd), separadas por virgula; nao use `*` com cookies.
- `RESEND_API_KEY`: chave privada do Resend para verificacao de e-mail e recuperacao de senha.
- `EMAIL_FROM`: remetente validado no dominio do Resend, por exemplo `PrintFlow <acesso@seudominio.com>`.
- `AUTH_REQUIRE_EMAIL_VERIFICATION`: use `true` para exigir confirmacao de e-mail em novos cadastros.
- `AUTH_REQUIRE_MFA_FOR_PRIVILEGED`: use `true` para exigir MFA em Owner e Superadmin; cada perfil configura o aplicativo autenticador em Configuracoes > Seguranca.

Para Mercado Livre, cadastre a mesma callback informada em
`MERCADO_LIVRE_REDIRECT_URI` no painel de desenvolvedores. Em producao ela deve
apontar para `/api/marketplace-integrations/oauth-callback` da API. O fluxo usa
PKCE e tentativas OAuth de uso unico; nunca copie tokens, authorization codes ou
secrets para o repositorio, logs ou canais de conversa.

Nao publique valores reais dessas variaveis.

### Ativacao da autenticacao reforcada

No Render, cadastre primeiro o dominio do remetente no Resend (SPF/DKIM), crie
uma API key somente com permissao de envio e informe `APP_PUBLIC_URL` com a URL
real do FrontEnd. Depois defina `RESEND_API_KEY`, `EMAIL_FROM` e
`AUTH_REQUIRE_EMAIL_VERIFICATION=true`. O cadastro passa a retornar uma tela de
aguardo e o link de verificacao expira em 15 minutos.

Para habilitar o segundo fator, defina `AUTH_REQUIRE_MFA_FOR_PRIVILEGED=true`.
Cada Owner/Superadmin deve abrir Configuracoes > Seguranca, cadastrar a chave no
Google Authenticator, 1Password ou aplicativo equivalente e confirmar o codigo.
Sem essa etapa o login privilegiado ficara impedido, portanto habilite a flag
somente depois de preparar os administradores.

## Publicacao

O repositorio possui verificacao continua em `.github/workflows/ci.yml`: a cada
push para `main` ou pull request, executa os testes do BackEnd e Agent e os
builds dos dois FrontEnds. A publicacao continua separada da verificacao e deve
ser feita somente depois que esses checks estiverem verdes.

No Render, configure o servico da API com diretorio raiz `BackEnd`, comando de
build `npm ci` e comando de inicio `npm start`. O inicio da API executa as
migracoes de forma idempotente antes de abrir a porta; confirme o backup do
banco e a saude do deploy antes de enviar trafego real.

Checklist de producao:

- Definir `DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY` e
  `WEBHOOK_SHARED_SECRET` como variaveis privadas no Render.
- Definir as quatro variaveis Mercado Livre e registrar exatamente a callback
  HTTPS da API em `MERCADO_LIVRE_REDIRECT_URI`.
- Publicar o FrontEnd com `NUXT_PUBLIC_API_BASE` apontando para a URL HTTPS da
  API e informar essa URL em `APP_PUBLIC_URL`.
- Confirmar que `/healthz`, login, a calculadora e um pedido de teste respondem
  no ambiente publicado antes de conectar uma impressora real.
- Configurar o monitor externo para consultar somente `GET /healthz`. O resumo
  autenticado `GET /api/operational-health` fica restrito a usuarios com acesso
  de producao e deve ser acompanhado pelo painel de Notificacoes.
- Para o Stripe, cadastrar no Dashboard o endpoint `POST
  https://SUA-API.onrender.com/webhooks/stripe` e habilitar `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
  `invoice.payment_failed`, `invoice.marked_uncollectible` e `invoice.voided`.
  Copiar o segredo `whsec_...` exibido pelo Stripe para `STRIPE_WEBHOOK_SECRET` no
  Render. O retorno do Checkout nao confirma a assinatura: somente o webhook com
  assinatura valida altera o acesso.
- Antes da primeira cobranca, no Superadmin > Empresas, informe os valores e
  o periodo de teste. A plataforma cria o produto e os precos mensal/anual pela
  API do Stripe e guarda os identificadores com alteracao auditada; a chave
  continua apenas nas variaveis privadas do Render.
- Manter backup recuperavel antes da primeira migracao e observar os logs do
  Render durante a inicializacao.

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

## Backup e Restauracao

O backup usa `pg_dump` instalado no computador ou no ambiente de deploy. Ele gera um arquivo no formato PostgreSQL customizado e remove os mais antigos conforme `BACKUP_RETENTION_COUNT`.

```powershell
npm.cmd run backup
```

A restauracao e propositalmente manual e exige confirmacao explicita, pois substitui dados no banco informado por `DATABASE_URL`.

```powershell
npm.cmd run restore -- caminho\\para\\printflow_arquivo.dump --confirm
```

Defina `BACKUP_DIR` em um diretorio privado e, em producao, envie os arquivos gerados para um storage externo com controle de acesso. O banco continua guardando apenas metadados dos arquivos de impressao; o driver local atual ja permite limpeza por tamanho e retencao.

## Rotas Principais

Autenticacao:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Assinatura Stripe (restrita ao Owner):

- `GET /api/billing/stripe`
- `POST /api/billing/stripe/checkout`
- `POST /webhooks/stripe`

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
