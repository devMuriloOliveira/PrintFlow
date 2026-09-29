# PrintFlow FrontEnd

Painel do cliente em Nuxt 4/Vue 3. Ele reúne dashboard, produtos, calculadora,
vendas, estoque, filamentos, impressoras, marketplaces, relatórios e
configurações. Os dados reais, a autenticação e as permissões pertencem ao
[BackEnd](../BackEnd/README.md).

## Rodar localmente

Use Node.js 24 e npm. No CMD, a partir da raiz do repositório:

```bat
npm.cmd --prefix FrontEnd ci
cd FrontEnd
set NUXT_PUBLIC_API_BASE=http://localhost:3333
npm.cmd run dev
```

A API deve estar configurada em outro terminal com um banco **local ou de
homologação**, conforme o README do BackEnd. Defina `NUXT_PUBLIC_API_BASE`
explicitamente: sem ela, o `nuxt.config.ts` aponta para a API pública padrão.
O login continua necessário para acessar as páginas protegidas.

Para gerar a versão estática:

```bat
npm.cmd run build
```

O build verifica compilação, não autenticação, persistência, OAuth, Stripe ou
funcionamento das impressoras no ambiente publicado.

## Revisar gráficos com dados fictícios

O composable `app/composables/useAppData.ts` pode fornecer dados de exemplo
apenas quando Nuxt está em modo de desenvolvimento. No CMD do FrontEnd, **antes
de iniciar** o servidor:

```bat
set NUXT_PUBLIC_API_BASE=http://localhost:3333
set NUXT_PUBLIC_USE_MOCK_DATA=true
npm.cmd run dev
```

Se já havia um servidor Nuxt aberto, encerre-o e inicie novamente. O mock
alimenta diversas listas, resumos e gráficos para inspeção visual; mudanças
feitas nele não são persistidas. Ele **não** cria uma sessão de usuário, não
substitui todas as chamadas à API e desabilita o OAuth real do Mercado Livre.
Não use essa opção como prova de que os relatórios, cobranças ou integrações
funcionam com dados reais. Para sair do modo mock, inicie outro terminal ou
execute `set NUXT_PUBLIC_USE_MOCK_DATA=false` e reinicie o Nuxt.

Uma revisão manual útil é abrir dashboard, `vendas`, `relatorios`, `estoque` e
`marketplaces` em larguras de desktop e celular, conferindo filtros, tabelas,
gráficos e estados vazios. Para validar persistência e permissões, repita com
uma conta de teste na API de homologação, sem dados de clientes reais.

## Configuração pública

| Variável | Uso |
| --- | --- |
| `NUXT_PUBLIC_API_BASE` | URL base da API. Use a origem local em desenvolvimento e HTTPS no deploy. |
| `NUXT_PUBLIC_USE_MOCK_DATA` | `true` habilita dados fictícios de `useAppData` somente em `dev`. |
| `NUXT_PUBLIC_AGENT_LOCAL_URL` | Endereço local do Agent; padrão `http://127.0.0.1:17873`. |
| `NUXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL` | URL pública do pacote Windows do Agent. |
| `NUXT_PUBLIC_AGENT_WINDOWS_DEV_CERTIFICATE_URL` | URL pública do certificado de teste, quando esse canal de distribuição for usado. |

Variáveis `NUXT_PUBLIC_*` são visíveis no navegador. Não coloque nelas
senhas, tokens, Access Codes, chaves Stripe ou credenciais de marketplace.
A API deve permitir a origem do FrontEnd em `CORS_ALLOWED_ORIGINS` quando eles
estiverem em domínios diferentes.

## Limites das integrações

- Mercado Livre oferece o fluxo OAuth e importação de pedidos, sujeito a
  credenciais e callback válidas no ambiente de destino.
- Shopee e Amazon podem ser usados como canais manuais. A integração
  automática ainda é apresentada como «Em breve».
- Impressoras cadastradas manualmente não exigem o Agent. Descoberta e
  comandos locais dependem do [PrintFlow Agent](../Agent/README.md) instalado
  e pareado; a simulação não equivale a um teste com hardware real.

O deploy deste Nuxt usa `ssr: false` e preset `static`. Publicar o FrontEnd é
uma etapa separada do push no GitHub; confirme a versão implantada e os fluxos
autenticados no domínio final.
