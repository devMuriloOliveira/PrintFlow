# Operação: desenvolvimento local

## Preparação

Use Node.js 24 conforme os READMEs e instale as dependências de cada aplicação:

```bat
npm.cmd --prefix BackEnd ci
npm.cmd --prefix FrontEnd ci
npm.cmd --prefix AdminFrontEnd ci
npm.cmd --prefix Agent ci
```

O Backend precisa de PostgreSQL local ou de homologação e de `BackEnd/.env.local`. Não use uma sessão de desenvolvimento apontando para o banco de produção.

## Iniciar os serviços

Em terminais separados, a partir da raiz:

```bat
npm.cmd --prefix BackEnd run dev
npm.cmd --prefix FrontEnd run dev
npm.cmd --prefix AdminFrontEnd run dev -- --port 3001
```

Para apontar os frontends para a API local, defina antes de iniciar:

```bat
set NUXT_PUBLIC_API_BASE=http://localhost:3333
```

O Agent pode usar a API local e um diretório de dados isolado conforme [Runtime e dados locais](../agent/runtime-and-local-data.md).

## Verificações locais

```bat
npm.cmd --prefix BackEnd test
npm.cmd --prefix Agent test
npm.cmd --prefix FrontEnd run build
npm.cmd --prefix AdminFrontEnd run build
```

Esses comandos são os checks declarados pelo projeto. Não existem scripts oficiais de lint, typecheck ou testes frontend nos manifests atuais.

## Segurança

Use somente contas, bancos, arquivos e credenciais de teste. Variáveis `NUXT_PUBLIC_*` são expostas no navegador e não podem conter segredos.
