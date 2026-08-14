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

## Isolamento de dados

As tabelas persistidas devem possuir `tenant_id`, e toda consulta precisa filtrar por esse campo. A tabela `products` ja segue esse modelo com `unique (tenant_id, sku)`.

Enquanto a autenticacao nao estiver pronta, o backend aceita `X-Tenant-Id` para desenvolvimento. Em producao, esse valor deve vir do usuario autenticado/JWT no backend, nunca de um campo editavel pelo front.
