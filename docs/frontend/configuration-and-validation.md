# Frontends: configuração, build e validação

## Dependências e scripts

Os dois aplicativos usam Nuxt `4.5.1`, Vue 3 e Vue Router. O `FrontEnd` também declara TypeScript como dependência de desenvolvimento. Os manifests atuais têm scripts `dev`, `build`, `generate` e `preview`; não declaram scripts próprios de lint, typecheck ou testes frontend.

## Desenvolvimento local

No CMD, a partir da raiz:

```bat
npm.cmd --prefix FrontEnd ci
set NUXT_PUBLIC_API_BASE=http://localhost:3333
npm.cmd --prefix FrontEnd run dev
```

Para o portal administrativo, use outra porta:

```bat
npm.cmd --prefix AdminFrontEnd ci
set NUXT_PUBLIC_API_BASE=http://localhost:3333
npm.cmd --prefix AdminFrontEnd run dev -- --port 3001
```

Quando API e frontend usam origens diferentes, a origem exata de cada painel deve estar em `CORS_ALLOWED_ORIGINS` da API local. Use `localhost` de forma consistente para que cookies e CORS tenham a mesma origem esperada.

## Build e publicação

Ambos usam `ssr: false` e preset `static`. Os builds oficiais são:

```bat
npm.cmd --prefix FrontEnd run build
npm.cmd --prefix AdminFrontEnd run build
```

O frontend do cliente e o portal administrativo são publicados separadamente. A hospedagem deve receber a origem HTTPS correta da API e o Backend deve permitir essa origem.

## Validação por nível

| Nível | O que prova | O que não prova |
| --- | --- | --- |
| Build | Compilação e empacotamento | Login, autorização, persistência ou deploy |
| Mock visual | Layout, listas, estados e gráficos de exemplo | Sessão, API real, cobrança ou impressora |
| API local | Contrato com Backend local e banco seguro | Produção, webhooks reais e serviços externos |
| Manual autenticado | Fluxos protegidos com conta de teste | Operação com dados reais sem autorização |
| Produção | Comportamento do artefato publicado | Não deve ser inferido apenas do build local |

## Segurança operacional

Nenhuma senha, token, e-mail administrativo, chave de marketplace ou segredo deve ser colocado em `NUXT_PUBLIC_*`, no Git, em screenshots ou na documentação.
