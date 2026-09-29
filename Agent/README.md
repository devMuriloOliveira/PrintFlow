# PrintFlow Agent

Programa local para Windows que conecta o PrintFlow às impressoras 3D do usuário. Ele roda no computador do usuário, aparece na bandeja do sistema quando iniciado pelo instalador/tray e executa comandos enviados pelo [BackEnd](../BackEnd/README.md). A versão do pacote neste repositório está em `package.json`; a versão mínima aceita pela API é configurável e tem padrão `0.1.10`.

## Para Que Serve

O Agent existe porque o navegador e o servidor em nuvem nao conseguem acessar diretamente impressoras na rede local ou conectadas por cabo USB. Ele faz essa ponte de forma controlada.

Com o Agent, o PrintFlow pode:

- descobrir impressoras na rede local;
- detectar impressoras USB/serial no Windows;
- conectar impressoras ao cadastro do usuario;
- consultar status, temperaturas e progresso;
- pausar, retomar, cancelar e desconectar;
- baixar arquivo de impressao validado pelo BackEnd;
- iniciar impressao quando o adapter da impressora suportar.

## Como Funciona

1. O usuario clica em adicionar impressora pelo Agent no site.
2. O site gera um codigo de pareamento.
3. O Agent usa esse codigo para se vincular a conta.
4. O Agent salva localmente a credencial do pareamento.
5. O Agent envia heartbeat periodico para o BackEnd.
6. O BackEnd cria comandos quando o usuario interage pelo site.
7. O Agent busca comandos pendentes, executa localmente e retorna o resultado.

O Agent nao e necessario quando o usuario cadastra uma impressora manualmente e nao quer controle automatico.

## Impressoras Suportadas

### Bambu Lab

Conexao pela rede local usando o protocolo MQTT/LAN.

Dados esperados:

- IP da impressora.
- Numero de serie.
- LAN Access Code.

Status e comandos basicos ja possuem fluxo preparado. Inicio real de impressao Bambu ainda depende do fechamento do fluxo de arquivo/protocolo com impressora real.

### USB / Marlin

Conexao por cabo USB usando porta serial no Windows.

Dados esperados:

- protocolo `marlin`;
- tipo de conexao `usb`;
- porta `COM`, por exemplo `COM3`;
- baud rate opcional, padrao `115200`.

Status e comandos basicos usam comandos G-code. Streaming completo de G-code para iniciar impressao ainda deve ser validado com impressoras reais.

### OctoPrint

Conexao pela API HTTP do OctoPrint.

Dados esperados:

- IP ou host.
- Porta, quando diferente do padrao.
- API Key.

Adapter com base para conectar, ler status, pausar, retomar, cancelar, enviar arquivo e iniciar impressao.

### Moonraker / Klipper

Conexao pela API HTTP do Moonraker.

Dados esperados:

- IP ou host.
- Porta, quando diferente do padrao.
- Token, quando a instancia exigir autenticacao.

Adapter com base para conectar, ler status, pausar, retomar, cancelar, enviar arquivo e iniciar impressao.

### PrusaLink

Conexao pela API HTTP do PrusaLink.

Dados esperados:

- IP ou host.
- Usuario.
- Senha.

Adapter com base para conectar, ler status, pausar, retomar, cancelar, enviar arquivo e iniciar impressao.

## Armazenamento Local

No Windows, o diretório padrão é `%APPDATA%\PrintFlow Agent`. Para um ambiente de desenvolvimento isolado, defina `PRINTFLOW_AGENT_DATA_DIR` **antes de iniciar** o processo. O Agent não usa, por padrão, uma pasta `data` dentro do código-fonte.

Arquivos locais principais (todos sob `PRINTFLOW_AGENT_DATA_DIR`, ou no diretório gerenciado do Agent):

- `agent.json`: credencial de pareamento protegida por DPAPI `CurrentUser` no
  Windows; arquivos antigos com `LocalMachine` podem ser lidos e migrados.
- `printer-credentials.json`: cofre local de credenciais de impressoras,
  protegido por DPAPI no Windows.
- `agent-operations.sqlite`: comandos processados, confirmações pendentes,
  outbox de eventos agregados e último estado local de impressoras/jobs.
- `cache/files` e `cache/gcode`: arquivos temporários de impressão/slicing.
- `logs`: logs locais do Agent.
- `diagnostics.token`: token temporario de acesso ao endpoint local de
  diagnostico; e substituido a cada inicializacao e removido ao encerrar.

O endpoint `/diagnostics` exige o token. Em desenvolvimento, consulte-o com
`npm.cmd run diagnostics` a partir de `Agent`; nao copie o arquivo de token
para anexos de suporte.

O conteúdo de `%APPDATA%\PrintFlow Agent` inclui credenciais e histórico
operacional. Não o inclua em Git, anexos de suporte ou capturas de tela. A
proteção DPAPI `CurrentUser` vincula os envelopes à conta Windows; copiar os
arquivos para outro usuário não é um procedimento de migração suportado.

## Bandeja do Windows

Quando iniciado pelo instalador Windows, o Agent roda em segundo plano e aparece na area de icones ocultos do Windows.

Menu disponivel:

- `Informacoes`: mostra versao, finalidade, API configurada e caminho dos logs.
- `Fechar Agent`: encerra o processo local.

## Protocolo Local

O instalador registra o protocolo:

```text
printflow-agent://
```

O FrontEnd usa esse protocolo para solicitar abertura do Agent instalado. Um exemplo de fluxo e abrir o Agent com um codigo de pareamento gerado pelo BackEnd.

Nao documente codigos reais de pareamento. Eles sao temporarios e devem ser usados somente pelo usuario durante a configuracao.

## Desenvolvimento Local

O runtime do Agent requer Node.js 22.13 ou superior, pois usa o SQLite nativo
do Node para manter comandos concluídos e confirmações pendentes após reinício.
No CMD, a partir da raiz do repositório:

```bat
cd Agent
npm.cmd ci
set PRINTFLOW_API_URL=http://localhost:3333
npm.cmd run start
```

Use uma API local ou de homologação. Para não misturar pareamento e credenciais
com uma instalação existente, escolha um diretório de dados de teste próprio:

```bat
set PRINTFLOW_AGENT_DATA_DIR=%LOCALAPPDATA%\PrintFlowAgent-Teste
npm.cmd run start
```

Teste com Bambu simulada, em ambiente de desenvolvimento:

```bat
set PRINTFLOW_DEV_MOCK_BAMBU=true
npm.cmd run start
```

O mock permite validar descoberta, conexão, status e comandos sem impressora
física. Ele não demonstra compatibilidade com um equipamento real. Com o Agent
rodando, `curl.exe http://127.0.0.1:17873/healthz` consulta o serviço local;
isso não prova que o heartbeat chegou à API nem que um comando de impressão foi
executado no hardware.

### OrcaSlicer local

O Agent possui um contrato local para executar o OrcaSlicer em modo headless.
O perfil precisa referenciar arquivos de máquina/processo e filamento
exportados pelo OrcaSlicer, sempre com uma versão identificável. O helper
`buildOfficialBambuP1SProfile()` usa os presets oficiais instalados como
referência para smoke test; ele não representa uma impressora cadastrada e
não envia trabalhos automaticamente.

O resultado só é aceito quando o Orca termina, o G-code é novo e não vazio,
e o Agent calcula seu tamanho e SHA-256. O caminho de produção deverá receber
o perfil real da impressora associado ao Production Job pelo Backend.

`analyzeModelFile()` valida localmente STL ASCII/binário (triângulos e limites)
e 3MF (container e modelo principal), sem enviar o modelo para a nuvem. Essa
análise é prévia ao slicing e não substitui a validação do Backend.

`sliceModelWithOrcaSlicer()` combina essa análise, a resolução do perfil exato
e a geração local do G-code. O resultado ainda fica local e não inicia uma
impressão.

Quando o G-code contém os comentários padrão do Orca, o pipeline também
retorna estimativas locais de tempo e filamento. Esses valores são apenas
estimativas; estoque, custo e consumo real continuam sendo responsabilidade
do Backend/Production Job.

Para uma impressora cadastrada, `resolveOfficialOrcaProfileForPrinter()` exige
um modelo exato com preset oficial (P1S, P1P, X1 Carbon, A1 ou A1 mini). Nao
ha fallback entre modelos: sem perfil correspondente o slicing e recusado.

## Compatibilidade

- Versão mínima padrão aceita pelo BackEnd: `0.1.10` (`MINIMUM_SUPPORTED_AGENT_VERSION`).
- Versoes anteriores devem usar o instalador completo/de transicao para chegar a uma versao atual; elas nao fazem parte do contrato funcional suportado.

## Scripts

- `npm.cmd run start`: inicia o Agent em modo console.
- `npm.cmd run dev`: inicia com reload de desenvolvimento.
- `npm.cmd run test`: roda testes automatizados.
- `npm.cmd run start:tray`: inicia o Agent com icone na bandeja do Windows.
- `npm.cmd run install:startup`: instala inicializacao no login do Windows.
- `npm.cmd run uninstall:startup`: remove inicializacao no login.
- `npm.cmd run install:agent`: instala o pacote no computador do usuario.
- `npm.cmd run uninstall:agent`: remove instalacao local.
- `npm.cmd run generate:icon`: gera PNG/ICO a partir do SVG.
- `npm.cmd run build:windows`: gera o pacote Windows baixavel.
- `npm.cmd run build:windows:dev-signed`: gera o instalador e assina com certificado local de teste.
- `npm.cmd run trust:windows:dev-cert`: confia o certificado local de teste no Windows atual.

## Gerar Pacote Windows

O script de empacotamento Windows exige **Node.js 24.19.0** por padrão e uma
URL de API adequada ao pacote. Não use uma URL local em artefatos destinados a
clientes. Para gerar um pacote no ambiente apropriado:

```bat
npm.cmd run build:windows
```

O pacote final e gerado em:

```text
Agent/dist/PrintFlow-Agent-Windows.zip
```

Quando gerado com assinatura local de desenvolvimento:

```bat
npm.cmd run build:windows:dev-signed
```

tambem sao gerados:

```text
Agent/dist/PrintFlow-Agent-Setup.exe
Agent/dist/PrintFlow-Agent-Dev-Certificate.cer
```

Para uma maquina de teste confiar nesse certificado antes de executar o instalador:

```bat
powershell -ExecutionPolicy Bypass -File scripts/trust-windows-agent-dev-certificate.ps1 -CertificatePath "dist\PrintFlow-Agent-Dev-Certificate.cer"
```

Esse comando e exclusivo para uma maquina de desenvolvimento controlada. No fluxo do cliente, o sistema apresenta as instrucoes e o usuario instala conscientemente o certificado em `CurrentUser\Root` e `CurrentUser\TrustedPublisher`; o instalador nunca altera as protecoes do Windows nem confia um certificado silenciosamente.

As releases Early Access reutilizam o mesmo PFX para que o certificado precise ser instalado somente uma vez. O workflow exige estes GitHub Actions secrets:

- `PRINTFLOW_AGENT_DEV_CERT_PFX_BASE64`: PFX persistente codificado em Base64.
- `PRINTFLOW_AGENT_DEV_CERT_PASSWORD`: senha do PFX persistente.

O pipeline falha se o PFX estiver ausente, se a assinatura nao existir, se o certificado do instalador divergir do `.cer` publicado ou se o IExpress truncar o payload. Nunca salve o PFX, a senha ou seu Base64 no Git.

Este canal continua sendo self-signed e adequado somente ao Early Access com consentimento explicito. Para distribuicao publica sem instalacao manual de certificado, use Microsoft Store/MSIX ou Code Signing confiavel.

Depois de extraido, o instalador copia o Agent para `%LOCALAPPDATA%\PrintFlowAgent`, registra a inicializacao no login, cria atalhos e registra o protocolo local.

O instalador informa a versao atual e a versao do pacote, o destino, a arquitetura
e que o runtime Node.js ja esta incluido. Atualizacoes preservam o pareamento,
as credenciais protegidas e o historico operacional local.

O desinstalador preserva esses dados por padrao para permitir reinstalacao sem
novo pareamento. A remocao completa e opcional, exige confirmacao explicita e
apaga o conteudo de `%APPDATA%\PrintFlow Agent`, incluindo pareamento,
credenciais de impressoras, cache, historico e logs.

## Variaveis de Ambiente

- `PRINTFLOW_API_URL`: URL da API do PrintFlow.
- `PRINTFLOW_PAIRING_CODE`: codigo temporario usado no pareamento automatico.
- `PRINTFLOW_AGENT_DATA_DIR`: diretorio local de dados e credenciais.
- `PRINTFLOW_AGENT_LOG_DIR`: diretorio local dos logs.
- `PRINTFLOW_DEV_MOCK_BAMBU`: ativa impressora Bambu simulada quando `true`.

Nao use valores reais de producao nos exemplos do README.

## Testes

```bat
npm.cmd test
```

O teste inclui `node --check src/index.js` e contratos automatizados. Antes de
declarar uma instalação funcional, confirme também o processo persistente, o
`/healthz` local e, em homologação, heartbeat e processamento de um comando.

Os testes atuais cobrem:

- fluxo mock Bambu;
- reconexao usando credenciais locais;
- perfis de impressora;
- upload/inicio de impressao em adapters HTTP;
- armazenamento de credenciais sem texto puro.

## Cuidados

- Nunca logar Access Code, senha ou API Key.
- Nunca retornar credenciais salvas para o FrontEnd.
- Validar formato e compatibilidade antes de iniciar impressao.
- Confirmar comandos avancados com impressoras reais antes de considerar suporte final.
- Manter comportamento simples para o usuario: instalar, parear e deixar rodando.
