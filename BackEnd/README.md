# BackEnd

API do PrintFlow 3D separada do front-end.

## Estrutura

- `src/server.js`: ponto de entrada do servidor HTTP.
- `src/config`: configuracoes de ambiente.
- `src/http`: utilitarios HTTP, CORS, JSON e leitura de payload.
- `src/routes`: definicao das rotas e handlers da API.
- `src/db`: conexao PostgreSQL e migracoes iniciais.
- `src/repositories`: consultas ao banco por recurso.
- `src/data.js`: dados temporarios em memoria.

## Variaveis de ambiente

Copie `.env.example` para `.env` somente no ambiente local e preencha os valores reais. O arquivo `.env` nao deve ir para o Git.

```powershell
Copy-Item .env.example .env
```

- `DATABASE_URL`: URL privada de conexao com o Neon/PostgreSQL.
- `PORT`: porta local da API.
- `ALLOW_DEMO_TENANT`: permite usar o tenant `demo` quando nao houver autenticacao real. Em producao com login/JWT, use `false`.

## Rodar localmente

```powershell
npm.cmd run dev
```

Servidor: `http://localhost:3333`.

## Deploy

No Render, configure o servico usando:

- Build command: vazio ou `npm install`
- Start command: `npm start`
- Root directory: `BackEnd`
- Environment variable: `DATABASE_URL` com a URL privada do Neon.

O front-end consome `https://printflow-api-4y5l.onrender.com` por padrao. Para apontar para outra API, configure a variavel `NUXT_PUBLIC_API_BASE`.

## Banco de dados

A migracao cria a base operacional do PrintFlow 3D:

- `tenants`: empresas/contas isoladas.
- `users`: usuarios vinculados a um tenant.
- `clients`, `suppliers`, `categories`.
- `products`, `filaments`, `printers`.
- `marketplaces` e `marketplace_fee_versions` para historico de taxas.
- `expenses`, `orders`, `order_items`.
- `goals` e `settings`.

Para executar as migracoes:

```powershell
npm.cmd run migrate
```

## Isolamento de dados

Todas as tabelas operacionais possuem `tenant_id` e as consultas do backend filtram por esse campo. Assim, clientes, produtos, despesas, vendas, filamentos, impressoras, marketplaces e metas de uma empresa nao aparecem para outra.

Enquanto a autenticacao nao estiver pronta, o backend aceita `X-Tenant-Id` para desenvolvimento. Em producao, esse valor deve vir do usuario autenticado/JWT no backend, nunca de um campo editavel pelo front.

Regras importantes:

- Toda tabela nova que guardar dado do cliente precisa ter `tenant_id`.
- Toda busca, criacao, atualizacao e exclusao precisa usar o `tenant_id` resolvido no backend.
- Chaves unicas de dados do cliente devem incluir o tenant, por exemplo `unique (tenant_id, sku)` e `unique (tenant_id, code)`.
