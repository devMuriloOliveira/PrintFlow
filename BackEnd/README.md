# BackEnd

API do PrintFlow 3D separada do front-end.

## Estrutura

- `src/server.js`: ponto de entrada do servidor HTTP.
- `src/config`: configuracoes de ambiente.
- `src/http`: utilitarios HTTP, CORS, JSON e leitura de payload.
- `src/routes`: definicao das rotas e handlers da API.
- `src/db`: conexao PostgreSQL, migracoes e carga inicial isolada por espaco.
- `src/repositories`: consultas ao banco por recurso.
- `src/data.js`: dados temporarios em memoria.

## Variaveis de ambiente

Copie `.env.example` para `.env` somente no ambiente local e preencha os valores reais. O arquivo `.env` nao deve ir para o Git.

```powershell
Copy-Item .env.example .env
```

- `DATABASE_URL`: URL privada de conexao com o Neon/PostgreSQL.
- `PORT`: porta local da API.
- `ALLOW_DEMO_TENANT`: somente para testes sem identificador. Mantenha `false` no Render.

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

## Modelo de dados e isolamento

As migracoes criam as tabelas `tenants`, `products`, `orders`, `expenses`, `filaments`, `printers`, `marketplaces`, `clients`, `goals`, `company_settings`, `calculator_simulations` e `export_history`. Todos os dados de negocio possuem `tenant_id`, indices por tenant e politicas de Row Level Security no PostgreSQL.

Como ainda nao existe cadastro, o front cria um identificador aleatorio de espaco de trabalho e o envia no header `X-Tenant-Id`, persistido apenas no navegador. Isso separa navegadores/espacos durante esta fase e evita uma conta `demo` compartilhada.

Essa etapa nao substitui autenticacao: alguem que alterar manualmente o header pode tentar acessar outro espaco. Antes de abrir o sistema para dados reais, substitua esse header por um tenant derivado de sessao/JWT validado exclusivamente no backend.

Regras importantes:

- Toda tabela nova que guardar dado do cliente precisa ter `tenant_id`.
- Toda busca, criacao, atualizacao e exclusao precisa usar o `tenant_id` resolvido no backend.
- Chaves unicas de dados do cliente devem incluir o tenant, por exemplo `unique (tenant_id, sku)`.
- Dados sensiveis devem ficar apenas em variaveis de ambiente privadas, nunca commitados no front ou no backend.
