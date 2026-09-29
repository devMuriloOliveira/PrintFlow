# PrintFlow BackEnd

API HTTP do PrintFlow 3D. Ela centraliza autenticação, isolamento por empresa, cadastros, fila de impressão, arquivos, integrações, cobrança e comunicação com o PrintFlow Agent. Este README descreve a API atual; não substitui a validação dos contratos em homologação.

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

O carregador em `src/config/env.js` lê **`BackEnd/.env.local`** fora de produção e fora dos testes. No CMD, a partir da raiz do repositório:

```bat
copy BackEnd\.env.example BackEnd\.env.local
```

Edite esse arquivo antes de iniciar a API. O `DATABASE_URL` do exemplo é um
placeholder, não um banco utilizável. Use apenas banco local ou de homologação:
`src/server.js` executa migrações e inicia jobs automaticamente ao subir.
Se `DATABASE_URL` estiver definido, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY` e
`WEBHOOK_SHARED_SECRET` precisam ter pelo menos 32 caracteres e
`CORS_ALLOWED_ORIGINS` é obrigatório. Não copie segredos para o README, Git,
logs ou chat.

Se os dois painéis estiverem rodando nas portas sugeridas nestes README, use
`CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001` **somente no
ambiente local**. Mantenha os domínios HTTPS reais separados na configuração
do ambiente publicado.

Variaveis principais:

- `DATABASE_URL`: string privada de conexao PostgreSQL.
- `PORT`: porta HTTP da API.
- `AUTH_SECRET`: segredo forte para assinatura dos access tokens.
- `AUTH_TOKEN_TTL_SECONDS`: duração do access token (padrão do código: 15 minutos, se não configurado).
- `REFRESH_TOKEN_TTL_SECONDS`: duração do refresh token (padrão do código: 30 dias, se não configurado).
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
- `OBJECT_STORAGE_PROVIDER`: `local` para desenvolvimento ou `r2` em produção.
- `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: necessários quando R2 está habilitado; mantenha-os privados.
- `MERCADO_LIVRE_CLIENT_ID`: App ID privado da aplicacao Mercado Livre.
- `MERCADO_LIVRE_CLIENT_SECRET`: Secret Key privada da aplicacao Mercado Livre.
- `MERCADO_LIVRE_REDIRECT_URI`: callback fixa registrada no Mercado Livre.
- `APP_PUBLIC_URL`: URL publica do FrontEnd usada ao finalizar OAuth e retornar do checkout.
- `CORS_ALLOWED_ORIGINS`: origens HTTPS autorizadas (FrontEnd e AdminFrontEnd), separadas por virgula; nao use `*` com cookies.
- `RESEND_API_KEY`: chave privada do Resend para verificacao de e-mail e recuperacao de senha.
- `EMAIL_FROM`: remetente validado no dominio do Resend, por exemplo `PrintFlow <acesso@seudominio.com>`.
- `AUTH_REQUIRE_EMAIL_VERIFICATION`: use `true` para exigir confirmacao de e-mail em novos cadastros.
- `AUTH_REQUIRE_MFA_FOR_PRIVILEGED`: use `true` para exigir MFA em Owner e Superadmin; cada perfil configura o aplicativo autenticador em Configuracoes > Seguranca.
- `PLATFORM_SUPER_ADMIN_EMAILS`: allowlist privada de superadmins. A API sincroniza essas funções ao iniciar; altere somente com controle administrativo.

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

O repositório possui verificação contínua em `.github/workflows/ci.yml` para
pushes e pull requests: varredura de segredos, testes do BackEnd e Agent,
builds dos dois FrontEnds e validação do pacote Windows do Agent. CI verde e
push no GitHub não comprovam que Render, Vercel, banco, webhooks ou dispositivos
reais estejam funcionando.

No Render, configure o serviço da API com diretório raiz `BackEnd`, build
`npm ci` e início `npm start`. O início da API executa migrações antes de abrir
a porta e inicia jobs operacionais; confirme backup recuperável, variáveis e
saúde do deploy antes de enviar tráfego real. Produção exige
`OBJECT_STORAGE_PROVIDER=r2` e credenciais R2 privadas válidas.

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
- Antes da primeira cobrança, configure o preço mensal em Superadmin >
  Empresas e valide o ambiente Stripe. Novos checkouts não oferecem trial;
  ciclos anuais existentes permanecem históricos e não são oferecidos para
  novas assinaturas. A chave privada continua somente no Render.
- Manter backup recuperavel antes da primeira migracao e observar os logs do
  Render durante a inicializacao.

## Rodar Localmente

No CMD, dentro de `BackEnd`, depois de preparar um banco local e
`BackEnd/.env.local`:

```bat
npm.cmd ci
npm.cmd run dev
```

Por padrao, a API local usa a porta configurada em `PORT` ou `3333`.

Rodar migracoes:

```bat
npm.cmd run migrate
```

Esse comando altera o banco indicado por `DATABASE_URL`; confirme a URL antes
de executá-lo. `npm.cmd run dev` e `npm.cmd start` já chamam as migrações na
inicialização do servidor.

Limpar dados demonstrativos em ambiente local:

```bat
npm.cmd run clean:demo
```

Use limpeza de dados demonstrativos somente no banco local destinado a isso.

## Testes

```bat
npm.cmd test
```

Os testes automatizados não substituem a validação de RLS no banco de destino,
webhooks Stripe assinados, OAuth real ou desempenho de homologação.

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

Arquivos de impressão não são salvos diretamente no banco. O banco guarda metadados, como nome, formato, hash, tamanho e chave de armazenamento. O storage pode ser local no desenvolvimento; em produção, a configuração exige R2.

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
