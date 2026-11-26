# Backend: execução e publicação

## Requisitos observados

- Node.js `>=20`, conforme `BackEnd/package.json`.
- PostgreSQL local ou de homologação para executar a API com persistência.
- Arquivo `BackEnd/.env.local` fora de produção e dos testes.

No CMD, a partir da raiz:

```bat
copy BackEnd\.env.example BackEnd\.env.local
npm.cmd --prefix BackEnd ci
npm.cmd --prefix BackEnd run dev
```

A API usa `PORT` quando definido e, por padrão, escuta na porta `3333`. O servidor executa migrações e inicia jobs operacionais durante a inicialização; por isso, `DATABASE_URL` deve apontar para uma base local ou de homologação confirmada.

## Comandos existentes

| Comando | Uso |
| --- | --- |
| `npm.cmd --prefix BackEnd run dev` | Desenvolvimento com `node --watch` |
| `npm.cmd --prefix BackEnd start` | Início do servidor |
| `npm.cmd --prefix BackEnd test` | Suíte automatizada |
| `npm.cmd --prefix BackEnd run migrate` | Executa migrações na base indicada |
| `npm.cmd --prefix BackEnd run seed:demo` | Cria dados fictícios somente em localhost |
| `npm.cmd --prefix BackEnd run clean:demo` | Remove os dados demonstrativos locais |
| `npm.cmd --prefix BackEnd run backup` | Gera backup PostgreSQL |
| `npm.cmd --prefix BackEnd run restore -- caminho\\arquivo.dump --confirm` | Restaura manualmente uma base, com confirmação |

Comandos de migração, limpeza e restauração alteram dados. A URL efetiva deve ser conferida antes da execução.

## Publicação documentada

O serviço publicado usa diretório raiz `BackEnd`, `npm ci` no build e `npm start` no Render. A configuração oficial também depende de Neon PostgreSQL e Cloudflare R2. Frontends publicados na Vercel devem apontar para a URL HTTPS da API.

CI verde comprova apenas as verificações executadas no pipeline. Não comprova deploy, webhooks, backup recuperável, RLS em produção, cobrança ou dispositivos reais.

## Variáveis sensíveis

`DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `WEBHOOK_SHARED_SECRET`, chaves de R2, Mercado Livre, Mercado Pago, Resend e Stripe são privadas. Seus valores não devem aparecer em documentação, Git, logs ou chat. Os nomes e requisitos completos permanecem em [`BackEnd/README.md`](../../BackEnd/README.md) e no arquivo `.env.example`.

## Verificação atual

O comando oficial da suíte é `npm.cmd --prefix BackEnd test`. A suíte usa fixtures e simuladores locais; os testes não substituem validação de OAuth real, webhooks assinados, banco publicado, RLS de produção ou hardware.
