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

## Aplicativo web instalável - 2026-11-27

O frontend inclui `manifest.webmanifest`, ícones PNG de 192 e 512 pixels e ícone Apple de 180 pixels, derivados da marca existente. O manifesto define o nome Filamind, início em `/` e abertura em modo `standalone`. A configuração de cabeçalho em `FrontEnd/nuxt.config.ts` referencia o manifesto e o ícone Apple.

Esta etapa não adiciona service worker, armazenamento offline, notificações push ou alterações na API. A disponibilidade da instalação e o comportamento de login no aplicativo instalado dependem do navegador e precisam ser verificados em aparelhos reais. O Agent local continua sendo um aplicativo Windows; `127.0.0.1` no celular aponta para o próprio celular.

Verificações locais: `npm.cmd --prefix FrontEnd run build` concluiu com 42 rotas pré-renderizadas. O servidor de desenvolvimento retornou HTTP 200 para `/login`, o manifesto e os três ícones; o manifesto foi servido como `application/manifest+json` e os ícones como `image/png`. As dimensões dos ícones foram verificadas localmente. A automação do navegador estava indisponível, portanto instalação, layout móvel e fluxos autenticados não foram exercitados. Nenhuma publicação, implantação ou alteração de dados de produção foi realizada.

## Navegação móvel - 2026-11-27

Em telas de até 700 px, `MobileNav.vue` apresenta atalhos por ícone para início, vendas e produtos, além de um botão para abrir o menu existente como painel inferior. O menu conserva os destinos, subseções e bloqueios de plano da barra lateral. A troca de rota e a tecla Escape fecham o menu; o layout reserva espaço para a barra e para a área segura inferior. Acima desse limite, a barra móvel fica oculta e o menu existente permanece em uso.

Foram alterados `FrontEnd/app/components/MobileNav.vue`, `AppSidebar.vue`, `app/layouts/default.vue` e `app/assets/css/main.css`. `npm.cmd --prefix FrontEnd run build` concluiu com sucesso; `git diff --check` não apontou erros de espaços. O projeto não declara script de testes de frontend. A automação visual e os especialistas de revisão não estavam disponíveis, portanto abertura, navegação, foco, acessibilidade, layout e rolagem em navegador ou celular ainda precisam de validação manual. O build não comprova esses comportamentos. Nenhuma implantação, publicação ou alteração em dados de produção foi realizada.

Na verificação posterior, o usuário relatou que a barra não aparecia no servidor local. O JavaScript do layout servido em `localhost:3000` resolvia `MobileNav` dinamicamente, enquanto os componentes existentes eram importados diretamente. Após adicionar importação explícita no layout, a resposta passou a incluir essa importação e o recurso do componente retornou HTTP 200. `npm.cmd --prefix FrontEnd run build` concluiu com sucesso. A exibição e a interação da barra no navegador do usuário permanecem pendentes de confirmação; não houve validação visual automatizada nem alteração de produção.

Na correção seguinte, a seleção da barra móvel e das subseções do menu lateral passou a consultar a rota atual do roteador, evitando depender da atualização posterior de `useRoute`. No navegador local, com largura simulada de 390 px, um clique abriu Produtos e destacou seu ícone; com 1200 px, um clique em Vendas abriu a página e destacou o item lateral. A inspeção não cobriu todos os submenus nem aparelhos físicos. `npm.cmd --prefix FrontEnd run build` concluiu com avisos de dependências externas do Nitro; `git diff --check` não apontou erros de espaços. A revisão independente não pôde ser executada por falta de acesso do especialista ao repositório. Nenhuma publicação ou mudança em dados de produção ocorreu.

Em 2026-11-27, o alinhamento de `.topbar-actions` em `FrontEnd/app/assets/css/main.css` foi ajustado para aproximar notificação e perfil da borda direita em larguras de até 780 px. Na visualização local de 390 px, os ícones ficaram à direita e o painel de notificações abriu dentro da área visível. O build `npm.cmd --prefix FrontEnd run build` concluiu e `git diff --check` não indicou erros de espaços. Não foi possível concluir a verificação visual em 320 px nem a revisão independente; não houve publicação ou alteração em dados de produção.

## Painel de notificações - 2026-11-27

O painel do cabeçalho limita sua altura à área visível e permite rolagem. Mostra as notificações não lidas entre as até 25 mais recentes carregadas e oferece acesso à página de histórico. A ação `Limpar exibidas` marca como lidas as notificações apresentadas, sem excluí-las; o estado de leitura existente pode ser compartilhado entre usuários da empresa. A página de histórico também está limitada às 25 mais recentes, sem paginação. Foram alterados `AppHeader.vue`, `useOperationalNotifications.ts` e `main.css`; os contratos da API e o esquema não foram alterados.

`node --test FrontEnd\test\operational-notifications.test.cjs` passou em dois testes com respostas simuladas, cobrindo sucesso e falha na marcação individual. `npm.cmd --prefix FrontEnd run build` concluiu com avisos do Nitro. O painel vazio foi observado localmente em larguras simuladas de 390 e 1200 px. Não foram exercitados a rolagem com muitas notificações nem o botão de limpeza no navegador, para evitar mudanças em dados reais; esses cenários e aparelhos físicos seguem pendentes. Não houve publicação, implantação ou alteração de dados de produção.

## Navegação de notificações e estoque baixo - 2026-11-27

O cabeçalho e a central encaminham tipos operacionais conhecidos para áreas internas, por meio de uma lista fixa em `FrontEnd/app/utils/notificationDestination.ts`. O texto indica a abertura de uma área geral, não de um registro específico. A navegação não aguarda a resposta da marcação de leitura; uma falha nessa marcação apresenta aviso. Tipos desconhecidos não geram destino.

Em `BackEnd/src/repositories/inventoryRepository.js`, uma movimentação de filamento que cruza de saldo acima do mínimo para saldo igual ou inferior gera `inventory.filament_low_stock`. Uma nova queda após reposição pode gerar outro aviso. O registro da notificação usa savepoint para isolar falha da inserção. Cadastro, edição direta de saldo ou limite e saldos já baixos não são cobertos por esse gatilho. Não foram alterados esquema ou contrato de API.

`node --test FrontEnd\test\notification-destination.test.cjs FrontEnd\test\operational-notifications.test.cjs` passou em seis testes. `node --test BackEnd\test\filament-low-stock-notifications.test.js` passou em três testes com cliente simulado. A suíte `npm.cmd --prefix BackEnd test` teve 219 aprovações e um teste de restauração ignorado por falta de PostgreSQL descartável. Testes simulados não comprovam transações, concorrência ou RLS em PostgreSQL real. O fluxo visual de clique e o alerta com banco real permanecem pendentes de validação. Notificações externas ao aplicativo não foram implementadas. Nenhuma publicação, implantação ou alteração de dados de produção foi realizada.

Na análise de segurança, identificou-se comportamento preexistente: o endpoint de marcação de leitura filtra por empresa e ID, mas não repete o filtro por destinatário aplicado à listagem. Uma pessoa com permissão de notificações que conheça o ID pode marcar como lida uma notificação destinada a outra pessoa da mesma empresa. A correção não integrou esta etapa e requer teste de autorização específico.

Em 2026-11-27, o aviso de filamento passou a ser acompanhado de aviso para produto sem unidades disponíveis, identificando nome e quantidade reservada. Em `inventoryRepository.js`, o evento cobre movimentações que zeram a disponibilidade; em `salesFulfillment.js`, cobre a reserva da última unidade em vendas diretas e de marketplace. A expedição de unidades já reservadas não cria outro aviso pela liberação intermediária da reserva. Saldos já indisponíveis e outros caminhos de alteração não foram retroativamente cobertos. Falhas de inserção do aviso são isoladas por savepoint, sem repetição automática.

`integrationsRepository.js` registra o aviso interno `marketplace.sale_received` como “Pedido importado para o Filamind”, inclusive para importações históricas, sem afirmar pagamento ou venda nova. A mensagem inclui plataforma, produto e data ou situação quando disponíveis e reconhecidos; não inclui ID externo nem dados de comprador. A deduplicação usa integração e hash do pedido. Falhas na consulta auxiliar ou no registro do aviso não bloqueiam a importação, mas podem ocasionar perda permanente do aviso, inclusive após falha parcial de pedido com múltiplas linhas. As rotas dos dois novos tipos apontam às áreas gerais de estoque e pedidos de marketplace.

`node --test BackEnd\test\marketplace-import-notifications.test.js BackEnd\test\product-reservation-notifications.test.js BackEnd\test\product-out-of-stock-notifications.test.js BackEnd\test\filament-low-stock-notifications.test.js` passou em 13 testes simulados. `npm.cmd --prefix BackEnd test` concluiu com 229 aprovações, nenhuma falha e um teste de restauração ignorado por falta de PostgreSQL descartável. `node --test FrontEnd\test\notification-destination.test.cjs` passou em quatro testes e `npm.cmd --prefix FrontEnd run build` concluiu. Os testes não comprovam concorrência, RLS ou savepoints em PostgreSQL real; o clique no navegador e o recebimento de pedido real não foram exercitados. Nenhuma notificação externa ao aplicativo, migração, implantação ou alteração em produção foi realizada.

## Cadastro sem documento - 2026-11-26

Na tela `/login`, CPF/CNPJ deixou de ser obrigatorio. O cliente recebe um aviso para completar o documento depois em **Configuracoes > Empresa**. A validacao continua ativa quando o valor e informado.
