# Frontend do cliente

## Responsabilidade

O `FrontEnd` é um aplicativo Nuxt 4/Vue 3 para a operação diária do cliente: dashboard, produtos, calculadora 3D, vendas, estoque, filamentos, impressoras, marketplaces, relatórios, notificações e configurações.

As páginas ficam em `FrontEnd/app/pages`. O estado e as chamadas principais são organizados em composables, incluindo autenticação e carregamento de dados do aplicativo.

## Áreas de navegação

- `/`: dashboard.
- `/produtos` e `/produtos/novo`: produtos e arquivos de impressão.
- `/calculadora-3d`: cálculo e fluxo de produto.
- `/vendas` e `/vendas/novo`: vendas e pedidos.
- `/estoque`: estoque e produção.
- `/filamentos`: filamentos.
- `/impressoras`: cadastro, conexão e operação local.
- `/marketplaces`: integrações e pedidos de marketplace.
- `/relatorios`: relatórios financeiros e operacionais.
- `/configuracoes`: empresa, assinatura, segurança, usuários, integrações, privacidade, backup e suporte.
- `/login`, `/verificar-email`, `/redefinir-senha` e `/aceitar-convite`: autenticação e acesso.

## Dados e autenticação

O frontend usa `NUXT_PUBLIC_API_BASE` para definir a API. As requisições autenticadas usam a sessão fornecida pelo Backend; tokens e segredos não devem ser colocados em variáveis `NUXT_PUBLIC_*`.

O modo `NUXT_PUBLIC_USE_MOCK_DATA=true` serve para revisão visual em desenvolvimento. Ele não cria sessão, não comprova persistência, não substitui todos os endpoints e não valida OAuth, cobrança ou impressoras reais.

## Agent e impressoras

Impressoras cadastradas manualmente podem ser usadas sem o Agent. Descoberta, comandos locais e integração do navegador dependem do Agent instalado e pareado, por padrão em `http://127.0.0.1:17873`.

## Limites

O build estático comprova compilação do frontend. Não comprova login, permissões, dados persistidos, integração de marketplace, cobrança, deploy na Vercel ou operação de hardware.

## Cadastro sem documento - 2026-11-26

Na tela `/login`, CPF/CNPJ deixou de ser obrigatorio. O cliente recebe um aviso para completar o documento depois em **Configuracoes > Empresa**. A validacao continua ativa quando o valor e informado.
