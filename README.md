# PrintFlow 3D

PrintFlow 3D é uma plataforma para gestão operacional e financeira de negócios de impressão 3D. O projeto reúne produtos, custos, estoque, pedidos, clientes, impressoras, marketplaces e fila de produção.

## Visao Geral

O repositório contém quatro aplicações independentes:

- [FrontEnd](./FrontEnd/README.md): painel do cliente em Nuxt/Vue.
- [BackEnd](./BackEnd/README.md): API, autenticação, isolamento por empresa, persistência e regras de negócio.
- [Agent](./Agent/README.md): aplicativo Windows que conecta impressoras locais por rede ou USB.
- [AdminFrontEnd](./AdminFrontEnd/README.md): portal interno de administração, publicado separadamente do painel do cliente.

O FrontEnd e o AdminFrontEnd usam a API; o Agent se comunica com o BackEnd e expõe apenas um serviço local em `127.0.0.1:17873` para detecção pelo navegador. O portal administrativo não é uma extensão do painel do cliente nem substitui a autorização no servidor.

## Pilares Consolidados

O PrintFlow 3D se apoia nos pilares abaixo. Esta secao define o que cada um
garante hoje e onde ainda existe dependencia externa para validacao final.

### 1. Isolamento por Tenant

O BackEnd resolve a identidade do tenant a partir do token autenticado e aplica
o contexto de tenant no acesso ao PostgreSQL. Recursos de outro tenant devem
ser tratados como inexistentes, sem revelar sua existencia. Esse limite vale
para dados operacionais, financeiros, arquivos, filas, impressoras e
integracoes.

### 2. Fonte Financeira do Produto

Cada produto preserva o detalhamento de custos e taxas em `costBreakdown`, alem
dos valores consolidados de custo, lucro e margem. O detalhamento e parte da
fonte de verdade do produto: interfaces e integracoes devem enviar e manter os
campos existentes, sem reduzi-los apenas a um total calculado.

### 3. Operacao de Impressao pelo Painel Principal

A tela principal de impressoras concentra a operacao cotidiana de equipamentos
conectados: disponibilidade do Agent, status, temperaturas, progresso, fila e
comandos de pausar, retomar, cancelar e desconectar. O fluxo deve continuar
funcionando tambem para impressoras cadastradas manualmente, sem exigir o
Agent quando nao houver automacao local.

### 4. Integracoes de Marketplace

O BackEnd centraliza as integrações. Mercado Livre usa OAuth PKCE e tentativas
temporárias de uso único; a conexão real depende de credenciais protegidas e
da callback registrada no provedor. Shopee e Amazon podem ser usados como
canais manuais, mas a integração automática ainda aparece como «Em breve».
Tokens, códigos de autorização e segredos não devem ir para o Git ou para o
navegador.

### 5. Confiabilidade Operacional

Heartbeats do Agent, comandos assincronos, status de impressora e o watchdog da
fila formam a base de acompanhamento operacional. Os testes automatizados
cobrem contratos locais; impressao real e adapters HTTP devem ser confirmados
com o hardware e as APIs reais antes de serem considerados suporte final.

## Limites Atuais

- A simulacao Bambu permite testar descoberta, conexao e comandos sem hardware.
- Bambu e Marlin/mock possuem maior cobertura local; OctoPrint, Moonraker e
  PrusaLink ainda requerem validacao com dispositivos e versoes reais das APIs.
- OAuth de marketplace exige credenciais protegidas e callback configurada no
  ambiente de destino.
- FREE mantém fluxos manuais úteis; automação e integrações dependem das
  permissões do plano PRO. O modo mock do FrontEnd não comprova esses contratos.
- Build, testes locais e push no GitHub não comprovam deploy, cobrança Stripe,
  isolamento RLS em produção nem operação com hardware real.

## Como Funciona

O usuario acessa o FrontEnd para cadastrar produtos, impressoras, pedidos e arquivos de impressao. O BackEnd valida e persiste esses dados de forma isolada por conta/tenant.

Quando a impressora e cadastrada manualmente, o usuario controla os dados pelo site sem instalar nada no computador. Quando a impressora precisa ser conectada automaticamente, o usuario baixa e instala o Agent. O Agent roda no Windows, aparece na bandeja do sistema e faz a ponte entre o site e as impressoras locais.

Fluxo resumido:

1. O usuario cria uma conta e acessa o painel.
2. O usuario cadastra produtos, arquivos de impressao, filamentos e impressoras.
3. Pedidos podem entrar manualmente ou por marketplace.
4. A fila de impressao permite escolher produto, impressora e ordem de execucao.
5. O BackEnd cria comandos para o Agent.
6. O Agent busca os comandos, conecta na impressora e retorna status/resultado.

## Impressoras

O Agent foi preparado para trabalhar com:

- Bambu Lab pela rede local.
- Marlin via USB/porta serial no Windows.
- OctoPrint pela API HTTP.
- Moonraker/Klipper pela API HTTP.
- PrusaLink pela API HTTP.

Bambu e Marlin/mock estao mais prontos para testes locais. OctoPrint, Moonraker e PrusaLink ja possuem base funcional para conexao, leitura de status e envio/inicio de arquivo, mas ainda precisam ser validados com impressoras reais e versoes reais das APIs.

## Estrutura

```text
.
|-- Agent
|-- AdminFrontEnd
|-- BackEnd
|-- FrontEnd
|-- .github/workflows/ci.yml
|-- package.json
`-- README.md
```

## Começar no Windows

Use Node.js 24 e npm. O Agent aceita runtime a partir de Node.js 22.13, mas o
empacotamento Windows atual exige a versão indicada em seu script de build.
Para a API real, providencie um PostgreSQL **local ou de homologação**: o
servidor executa migrações e jobs ao iniciar. Não aponte uma sessão de
desenvolvimento para o banco de produção.

No CMD, a partir da raiz do repositório:

```bat
npm.cmd --prefix BackEnd ci
npm.cmd --prefix FrontEnd ci
npm.cmd --prefix AdminFrontEnd ci
npm.cmd --prefix Agent ci
copy BackEnd\.env.example BackEnd\.env.local
```

Edite `BackEnd\.env.local` com **valores locais válidos**, especialmente
`DATABASE_URL` e os segredos necessários. O arquivo de exemplo contém apenas
placeholders e não é uma configuração pronta para subir a API. Execute em
terminais separados:

```bat
npm.cmd --prefix BackEnd run dev
```

```bat
cd FrontEnd
set NUXT_PUBLIC_API_BASE=http://localhost:3333
npm.cmd run dev
```

Para o painel administrativo ou o Agent, consulte os README dos respectivos
módulos antes de iniciar. Não é necessário instalar dependências na raiz: os
quatro módulos têm seus próprios `package-lock.json`.

### Dados fictícios para revisão visual

O FrontEnd possui dados mockados para desenvolvimento. No **CMD do FrontEnd**,
defina a variável antes de iniciar o Nuxt:

```bat
cd FrontEnd
set NUXT_PUBLIC_USE_MOCK_DATA=true
npm.cmd run dev
```

O mock é usado por `useAppData` somente em modo `dev`; ele ajuda a revisar
gráficos, listas e estados de interface. **Não desativa o login**, não simula
todas as chamadas da aplicação e não valida backend, persistência, permissões
ou integrações reais. Para retornar à API, abra outro terminal ou execute
`set NUXT_PUBLIC_USE_MOCK_DATA=false` antes de reiniciar o servidor.

## Configuracao

As configuracoes sensiveis devem ficar em variaveis de ambiente locais ou no provedor de hospedagem. Nao coloque senhas, tokens, URLs privadas de banco, chaves de API ou Access Codes de impressoras nos READMEs ou no Git.

Consulte as instruções específicas:

- [FrontEnd](./FrontEnd/README.md)
- [BackEnd](./BackEnd/README.md)
- [Agent](./Agent/README.md)
- [AdminFrontEnd](./AdminFrontEnd/README.md)

## FrontEnd

O FrontEnd e a interface web do PrintFlow 3D. Ele e usado para:

- cadastrar produtos e arquivos de impressao;
- controlar pedidos manuais e pedidos vindos de marketplaces;
- gerenciar filamentos, custos, despesas, clientes e metas;
- cadastrar impressoras manualmente ou usando o Agent;
- acompanhar impressoras conectadas, status, temperaturas e progresso;
- escolher qual produto ou item da fila sera enviado para qual impressora.

O FrontEnd conversa somente com o BackEnd pela API configurada em `NUXT_PUBLIC_API_BASE`. Essa variavel e publica no navegador, entao nao deve receber segredos, senhas, tokens privados ou chaves internas.

Variaveis publicas:

- `NUXT_PUBLIC_API_BASE`: URL base da API.
- `NUXT_PUBLIC_AGENT_WINDOWS_DOWNLOAD_URL`: URL publica do pacote Windows do Agent.
- `NUXT_PUBLIC_AGENT_WINDOWS_DEV_CERTIFICATE_URL`: URL publica do certificado de teste do Agent.
- `NUXT_PUBLIC_AGENT_LOCAL_URL`: URL local usada pelo site para detectar o Agent aberto no computador. Padrao: `http://127.0.0.1:17873`.

Fluxo de impressoras pelo Agent:

1. O usuario escolhe adicionar impressora pelo Agent.
2. O site detecta o Agent local quando ele esta aberto. Se detectar, esconde os downloads e usa o Agent instalado.
3. O site gera um codigo temporario de pareamento.
4. O Agent se vincula a conta e fica online.
5. O site lista as impressoras encontradas.
6. O usuario escolhe a impressora, informa os dados necessarios e conecta.
7. Depois disso, a impressora aparece na tela principal junto com as demais.

Cuidados no FrontEnd:

- nao salvar credenciais sensiveis em storage do navegador;
- nao exibir Access Code Bambu, API Key OctoPrint, token Moonraker ou senha PrusaLink depois da conexao;
- manter validacoes finais no BackEnd antes de iniciar impressao;
- preservar a identidade visual atual das telas ao adicionar novos recursos.

## Testes

BackEnd:

```powershell
npm.cmd --prefix BackEnd test
```

Agent:

```powershell
npm.cmd --prefix Agent test
```

FrontEnd build:

```powershell
npm.cmd --prefix FrontEnd run build
```

AdminFrontEnd build:

```powershell
npm.cmd --prefix AdminFrontEnd run build
```

O CI em [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) verifica
segredos/configuração, testes de BackEnd e Agent, builds dos dois painéis e
o pacote Windows do Agent. Um push não substitui a conferência do deploy e
dos fluxos autenticados no ambiente de destino.

## Seguranca

- O tenant deve ser resolvido no BackEnd a partir do token autenticado.
- Dados sensiveis ficam em variaveis de ambiente ou armazenamento local protegido.
- Credenciais de impressoras nao devem ser retornadas para o FrontEnd depois de salvas.
- Arquivos de impressão ficam fora do banco; o banco guarda metadados e chave de armazenamento. Em produção, o BackEnd exige o provedor de object storage configurado.
- Validacoes de formato, volume, material e perfil devem acontecer antes de enviar um arquivo para impressao.
