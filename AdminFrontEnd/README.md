# Filamind AdminFrontEnd

Portal interno em Nuxt 4/Vue 3, separado do [painel do cliente](../FrontEnd/README.md).
Ele oferece visão operacional, fila de suporte, empresas, auditoria, relatórios
e evidências de exclusão. O menu e as telas **não são a barreira de segurança**:
o [BackEnd](../BackEnd/README.md) valida a identidade e a autorização das
rotas administrativas. Ações sensíveis e exportações seguem os contratos de
auditoria do servidor; uma leitura comum não deve ser descrita como alteração
auditada.

## Rodar localmente

Use Node.js 24, npm, uma API local ou de homologação e uma conta de teste
autorizada como superadmin da plataforma. No CMD, a partir da raiz:

```bat
npm.cmd --prefix AdminFrontEnd ci
cd AdminFrontEnd
set NUXT_PUBLIC_API_BASE=http://localhost:3333
npm.cmd run dev -- --port 3001
```

Se a API e o portal usarem origens diferentes, inclua a origem exata do portal
em `CORS_ALLOWED_ORIGINS` do BackEnd, por exemplo `http://localhost:3001` no
ambiente local. Use `localhost` de forma consistente; cookies e CORS dependem
da origem. Sem `NUXT_PUBLIC_API_BASE`, o `nuxt.config.ts` usa a API pública
padrão, por isso defina essa variável antes de iniciar o servidor local.

A lista privada `PLATFORM_SUPER_ADMIN_EMAILS` pertence apenas à configuração
do BackEnd. Ao iniciar, a API sincroniza a função dos usuários configurados;
não altere essa lista em produção para testar interface. Nunca coloque
e-mails administrativos, senhas ou tokens em variáveis `NUXT_PUBLIC_*`, no Git
ou em capturas de tela.

## Áreas do portal

| Rota | Finalidade |
| --- | --- |
| `/` | Indicadores da plataforma, prioridades, fila recente e regras de SLA. |
| `/solicitacoes` | Fila, filtros, triagem LGPD e atendimento interno. |
| `/empresas` | Empresas, estados de conta/cobrança e configurações de plano. |
| `/empresas/:id` | Uso, assinatura, usuários e histórico da empresa. |
| `/auditoria` | Eventos administrativos, acessos autorizados por empresa e relatórios. |
| `/exclusoes` | Evidências preservadas de exclusões. |

Mudanças de status, assinatura, preço, SLA e decisões LGPD podem afetar
clientes ou cobrança. Teste essas ações somente com empresas fictícias e
autorização apropriada. Acesso a eventos de uma empresa exige um protocolo
aprovado e ainda válido; o BackEnd volta a verificar esse limite na consulta.

O mock visual `NUXT_PUBLIC_USE_MOCK_DATA` é do FrontEnd de clientes e **não**
fornece sessão nem dados para este portal. Um build bem-sucedido também não
exercita páginas protegidas, permissões ou ações administrativas.

## Build e publicação

```bat
npm.cmd run build
```

O Nuxt usa `ssr: false` e preset `static`. Em uma hospedagem própria para o
portal, selecione `AdminFrontEnd` como diretório raiz, instale com `npm ci`,
execute `npm run build` e configure `NUXT_PUBLIC_API_BASE` com a URL HTTPS da
API. Adicione a origem HTTPS do portal a `CORS_ALLOWED_ORIGINS` no BackEnd.
O metadado `noindex` reduz indexação, mas não substitui autenticação.

Depois da implantação, confirme login, navegação e leituras em desktop e
celular usando uma conta de teste. Revise fluxos de escrita em homologação,
incluindo confirmação/cancelamento e trilha de auditoria. Push no GitHub e
build local não comprovam que a versão implantada passou por essas verificações.
