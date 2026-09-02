# PrintFlow 3D

PrintFlow 3D e uma plataforma para gestao operacional e financeira de negocios de impressao 3D. O projeto organiza produtos, pedidos, custos, filamentos, impressoras, marketplaces e fila de impressao em uma mesma aplicacao.

## Visao Geral

O sistema e dividido em tres partes:

- `FrontEnd`: interface web em Nuxt/Vue usada pelo usuario.
- `BackEnd`: API HTTP responsavel por autenticacao, dados do tenant, validacoes, fila de impressao e comandos para o Agent.
- `Agent`: programa local para Windows que conecta o computador do usuario as impressoras 3D por rede ou USB.

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
|-- BackEnd
|-- FrontEnd
|-- package.json
`-- README.md
```

## Rodar Localmente

Instale as dependencias em cada modulo conforme necessario:

```powershell
npm.cmd install
npm.cmd --prefix BackEnd install
npm.cmd --prefix FrontEnd install
npm.cmd --prefix Agent install
```

Rodar API:

```powershell
npm.cmd run dev:back
```

Rodar FrontEnd:

```powershell
npm.cmd run dev:front
```

Rodar FrontEnd apontando para API local:

```powershell
npm.cmd run dev:front:local-api
```

Rodar Agent local:

```powershell
npm.cmd --prefix Agent run start
```

## Configuracao

As configuracoes sensiveis devem ficar em variaveis de ambiente locais ou no provedor de hospedagem. Nao coloque senhas, tokens, URLs privadas de banco, chaves de API ou Access Codes de impressoras nos READMEs ou no Git.

Consulte os READMEs especificos:

- [BackEnd](./BackEnd/README.md)
- [Agent](./Agent/README.md)

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

## Seguranca

- O tenant deve ser resolvido no BackEnd a partir do token autenticado.
- Dados sensiveis ficam em variaveis de ambiente ou armazenamento local protegido.
- Credenciais de impressoras nao devem ser retornadas para o FrontEnd depois de salvas.
- Arquivos de impressao devem ser armazenados fora do banco; o banco deve guardar apenas metadados e chave de armazenamento.
- Validacoes de formato, volume, material e perfil devem acontecer antes de enviar um arquivo para impressao.
