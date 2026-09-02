# PrintFlow Platform Admin

Portal interno separado do painel de clientes. Ele deve ser publicado em um subdominio proprio, como `admin.seudominio.com`, com raiz de deploy em `AdminFrontEnd`.

O portal nao carrega no `FrontEnd` publico. Mesmo assim, a protecao real esta no BackEnd: todas as rotas `/api/platform-admin/*` validam super admin no servidor e registram acesso no log de auditoria.

## Configuracao

No BackEnd, configure somente no provedor de hospedagem:

```text
PLATFORM_SUPER_ADMIN_EMAILS=email-1,email-2
```

Nao coloque essa lista no FrontEnd, no repositorio ou em variaveis `NUXT_PUBLIC_*`.

No deploy do portal configure:

```text
NUXT_PUBLIC_API_BASE=https://sua-api
```

## Desenvolvimento

```powershell
npm.cmd --prefix AdminFrontEnd run dev
```
