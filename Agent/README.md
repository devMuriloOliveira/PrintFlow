# Fila Agent

Em producao, o servidor local aceita conexoes do site oficial em
`https://filamind.com.br` e `https://www.filamind.com.br`. A lista padrao fica
em `src/config/config.js`; mantenha origens personalizadas em
`PRINTFLOW_APP_ORIGINS` para builds de homologacao.

Programa local para Windows que conecta este computador ao Filamind e às impressoras 3D autorizadas pelo usuário. Ele roda no computador do usuário, aparece na bandeja do sistema quando iniciado pelo instalador e executa comandos enviados pelo [BackEnd](../BackEnd/README.md). A versão do pacote neste repositório está em `package.json`; a versão mínima aceita pela API é configurável e tem padrão `0.1.10`.

## Para Que Serve

O Agent existe porque o navegador e o servidor em nuvem nao conseguem acessar diretamente impressoras na rede local ou conectadas por cabo USB. Ele faz essa ponte de forma controlada.

Com o Fila Agent, o Filamind pode:

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

O nome `PrintFlow Agent` nesses diretórios e nas variáveis antigas é mantido para que atualizações preservem pareamento e credenciais das instalações anteriores. O nome exibido do aplicativo é `Fila Agent`.

Arquivos locais principais (todos sob `PRINTFLOW_AGENT_DATA_DIR`, ou no diretório gerenciado do Agent):

- `agent.json`: credencial de pareamento protegida por DPAPI `CurrentUser` no
  Windows; arquivos antigos com `LocalMachine` podem ser lidos e migrados.
- `printer-credentials.json`: cofre local de credenciais de impressoras,
  protegido por DPAPI no Windows.
- `agent-operations.sqlite`: comandos processados, confirmações pendentes,
  outbox de eventos agregados e último estado local de impressoras/jobs.
- `cache/files` e `cache/gcode`: arquivos temporários de impressão/slicing.
- `logs`: logs locais do Agent.
- `diagnostics.token`: token temporario protegido por DPAPI para o endpoint
  local; e substituido a cada inicializacao e removido ao encerrar. Se o perfil
  do Windows nao permitir DPAPI durante a inicializacao, o endpoint retorna 503
  e o runtime continua sem gravar token em texto puro.

O endpoint `/diagnostics` e implementado pelo runtime C# e exige o token. Os
comandos Node `npm.cmd run diagnostics` e `npm.cmd run support-bundle` sao
ferramentas locais de desenvolvimento; o helper procura o host C# instalado ou
aceita `FILA_AGENT_HOST_PATH` para abrir o token via DPAPI. O cabecalho novo e
`x-fila-agent-diagnostics-token`; o alias `x-printflow-diagnostics-token` e
mantido para compatibilidade. Nao copie o arquivo de token para anexos.

Para gerar um pacote JSON seguro com o snapshot local, sem logs brutos nem
credenciais, execute `npm.cmd run support-bundle -- "C:\\Temp\\fila-agent-support.json"`.
O comando recusa sobrescrever um arquivo existente.

O conteúdo de `%APPDATA%\PrintFlow Agent` inclui credenciais e histórico
operacional. Não o inclua em Git, anexos de suporte ou capturas de tela. A
proteção DPAPI `CurrentUser` vincula os envelopes à conta Windows; copiar os
arquivos para outro usuário não é um procedimento de migração suportado.

## Bandeja do Windows

Quando iniciado pelo instalador Windows, o Agent roda em segundo plano e aparece na area de icones ocultos do Windows.

Menu disponivel:

- `Abrir status`: mostra conexao, versao instalada e estado da producao.
- `Verificar atualizacoes`: procura e oferece atualizacoes assinadas.
- `Abrir logs`: abre os registros locais do Agent.
- `Fechar Agent`: encerra o processo local.

## Protocolo Local

O instalador registra o protocolo:

```text
fila-agent://
```

O FrontEnd usa esse protocolo para solicitar abertura do Agent instalado. O setup registra somente `fila-agent://` e remove a chave antiga durante a atualizacao. Um exemplo de fluxo e abrir o Agent com um codigo de pareamento gerado pelo BackEnd.

Nao documente codigos reais de pareamento. Eles sao temporarios e devem ser usados somente pelo usuario durante a configuracao.

## Desenvolvimento Local

O runtime instalado e os comandos padrão de desenvolvimento usam C#/.NET 8.
Node permanece no repositório para testes de paridade e comparação com o runtime
antigo; ele não é incluído no pacote Windows. No CMD, a partir da pasta `Agent`:
Build, instalação, atualização, assinatura e publicação usam o setup/ReleaseTool
C# e ferramentas nativas; scripts PowerShell não são necessários. Node continua
sendo necessário para executar a suíte de testes e o runtime de referência.

```bat
cd Agent
npm.cmd ci
set FILA_AGENT_ENVIRONMENT=DEVELOPMENT
set FILA_AGENT_API_URL=http://localhost:3333
npm.cmd run start
```

Use uma API local ou de homologação. Para não misturar pareamento e credenciais
com uma instalação existente, escolha um diretório de dados de teste próprio:

```bat
set FILA_AGENT_DATA_DIR=%LOCALAPPDATA%\PrintFlowAgent-Teste
npm.cmd run start
```

Teste com Bambu simulada, em ambiente de desenvolvimento:

```bat
set FILA_AGENT_DEV_MOCK_BAMBU=true
npm.cmd run start
```

O mock permite validar descoberta, conexão, status e comandos sem impressora
física. Ele não demonstra compatibilidade com um equipamento real. Com o Agent
rodando, `curl.exe http://127.0.0.1:17873/healthz` consulta o serviço local;
isso não prova que o heartbeat chegou à API nem que um comando de impressão foi
executado no hardware.

### OrcaSlicer local

O instalador Windows instala ou reutiliza o OrcaSlicer oficial pela Microsoft
Store (`9MV6GL23XM59`). A identidade verificada e
`OrcaSlicer.OrcaSlicer_3qd7h69xpne0g`, com assinatura Store. A versao de pacote
testada e 2.4.3.0, cujo motor gera G-code como OrcaSlicer 2.4.2. Outras versoes
exigem nova validacao antes de serem aceitas automaticamente.

A primeira instalacao exige internet, acesso a Microsoft Store e App Installer
(WinGet). Uma instalacao existente validada e reutilizada sem novo download.
O Agent resolve o caminho Store uma vez ao iniciar, incluindo a pasta da versao
atual; `PRINTFLOW_ORCA_SLICER_PATH` explicito continua tendo prioridade.
Nao ha fallback automatico para copias sem assinatura em Program Files.
O instalador fica menor porque nao inclui o ZIP portatil de 171 MB.

O ZIP oficial portatil foi descartado deste fluxo: seu `TKSTEPBase.dll` foi
bloqueado pelo Code Integrity (evento 3077, erro 4551). A versao Store passou
no fatiamento real neste Windows, sem alteracao nas protecoes do sistema.
O construtor C# e o setup verificam os perfis dos modelos suportados e geram
G-code de um cubo local usando o Orca instalado. Nenhuma impressora e acessada.
Uma falha bloqueia o pacote ou cancela a instalacao antes de parar o Agent,
copiar arquivos ou registrar tarefas. O ambiente de build/release tambem precisa
permitir instalar aplicativos Store.
Se o fatiamento falhar, o setup interrompe a instalação antes de parar o Agent
ou substituir arquivos existentes e mostra a causa na mensagem de erro. Quando
executado em modo silencioso ou de teste, grava detalhes em
`%APPDATA%\PrintFlow Agent\logs\installer.log` ou no diretório temporário do
teste; não registra credenciais nem inicia impressão.
Para repetir somente esse teste no CMD, execute
`dotnet run --project windows-runtime-live-smoke\FilaAgent.OrcaStore.LiveSmoke.csproj --configuration Release`.
Essa verificacao nao instala software nem altera o Agent existente.
O Orca e independente: a reversao/desinstalacao do Agent nao remove o pacote
Store nem as configuracoes do usuario. Publicacao, instalador assinado e
validacao em outra maquina continuam sendo etapas separadas.

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

- `npm.cmd run start`: inicia o host C# com variaveis de ambiente de desenvolvimento.
- `npm.cmd run dev`: inicia o host C# com reload de desenvolvimento.
- `npm.cmd run test`: roda testes automatizados.
- `npm.cmd run start:tray`: inicia o host C# com icone na bandeja do Windows.
- `npm.cmd run start:node-reference`: inicia o runtime Node de referencia.
- `npm.cmd run dev:node-reference`: inicia o runtime Node com reload.
- `npm.cmd run install:agent`: recompila o setup C# atual e abre a tela do instalador.
- `npm.cmd run uninstall:agent`: abre o setup C# da instalação atual para desinstalar.
- `npm.cmd run generate:icon`: gera PNG/ICO a partir do SVG.
- `npm.cmd run build:windows`: gera o ZIP e o instalador nativo C# autocontido.
- `npm.cmd run build:windows:dev-signed`: assina host e instalador com o PFX Early Access persistente.

## Gerar Pacote Windows

O empacotador Windows e escrito em C# e requer o SDK .NET 8, Windows SDK
Signing Tools quando houver assinatura e OrcaSlicer oficial para a validação
local de G-code. Não use uma URL local em artefatos destinados a clientes.
Para gerar um pacote:

```bat
npm.cmd run build:windows
```

O pacote final e gerado em:

```text
Agent/dist/Fila-Agent-Windows.zip
```

Quando gerado com assinatura local de desenvolvimento:

```bat
npm.cmd run build:windows:dev-signed
```

tambem sao gerados:

```text
Agent/dist/Fila-Agent-Setup.exe
Agent/dist/Fila-Agent-Dev-Certificate.cer
```

Ao preparar uma release, o pipeline tambem publica aliases `PrintFlow-Agent-*`
para que versoes instaladas anteriormente continuem encontrando o setup e o
certificado. Instalacoes novas e o atualizador Fila Agent usam primeiro os
nomes `Fila-Agent-*`.

O instalador apresenta a escolha de confiar no certificado Early Access antes
de adiciona-lo aos armazenamentos do usuario atual. Nao desative Smart App
Control para contornar bloqueios.

As releases Early Access reutilizam o mesmo PFX para que o certificado precise ser instalado somente uma vez. O workflow exige estes GitHub Actions secrets:

- `FILA_AGENT_DEV_CERT_PFX_BASE64`: PFX persistente codificado em Base64.
- `FILA_AGENT_DEV_CERT_PASSWORD`: senha do PFX persistente.

O pipeline prefere secrets `FILA_AGENT_*` e ainda aceita os nomes
`PRINTFLOW_AGENT_DEV_CERT_*` como fallback durante a transicao. Falha se o PFX
estiver ausente, se a assinatura nao existir ou se o certificado do instalador
divergir do `.cer` publicado. Nunca salve o PFX, a senha ou seu Base64 no Git.

Este canal continua sendo self-signed e adequado somente ao Early Access com consentimento explicito. Para distribuicao publica sem instalacao manual de certificado, use Microsoft Store/MSIX ou Code Signing confiavel.

Depois de extraido, o instalador copia o Agent para `%LOCALAPPDATA%\PrintFlowAgent`, registra a inicializacao no login, cria atalhos e registra o protocolo local.

O instalador informa a versao atual e a versao do pacote, o destino e a
arquitetura. O executavel autocontido inclui o runtime C# e o ZIP do Agent.
Atualizacoes preservam o pareamento,
as credenciais protegidas e o historico operacional local.

O desinstalador preserva esses dados por padrao para permitir reinstalacao sem
novo pareamento. A remocao completa e opcional, exige confirmacao explicita e
apaga o conteudo de `%APPDATA%\PrintFlow Agent`, incluindo pareamento,
credenciais de impressoras, cache, historico e logs.

## Variaveis de Ambiente

- `PRINTFLOW_API_URL`: URL da API hospedada do Filamind. O nome desta variável é mantido por compatibilidade.
- `PRINTFLOW_PAIRING_CODE`: codigo temporario usado no pareamento automatico.
- `PRINTFLOW_AGENT_DATA_DIR`: diretorio local de dados e credenciais.
- `PRINTFLOW_AGENT_LOG_DIR`: diretorio local dos logs.
- `PRINTFLOW_DEV_MOCK_BAMBU`: ativa impressora Bambu simulada quando `true`.
- `MAX_CONCURRENT_PRINTER_COMMANDS` (padrao `4`): limite global de comandos de impressora; cada impressora continua serializada.
- `MAX_CONCURRENT_SLICING_JOBS` (padrao `1`): limite separado para comandos de slicing.
- `PRINTFLOW_AGENT_OUTBOX_MAX_ATTEMPTS` (padrao `10`): tentativas de envio antes de marcar eventos/metricas invalidos como dead-letter.
- `PRINTFLOW_AGENT_MAX_PENDING_OPERATIONS` (padrao `5000`, minimo efetivo `100`): pausa temporariamente a busca de novos comandos quando o total local pendente atinge o limite, preservando comandos ja recebidos.
- `FILA_AGENT_HEALTH_SNAPSHOT_MS` (`PRINTFLOW_AGENT_HEALTH_SNAPSHOT_MS` como alias legado; padrao/minimo `60000`): intervalo minimo para enviar health agregado junto ao heartbeat, sem uma requisicao por metrica.
- As metricas operacionais guardam buckets limitados de duracao; o Cloud estima p50/p95/p99 pelo limite superior de cada faixa e ignora contadores antigos que ainda nao tinham histograma.
- `PRINTFLOW_AGENT_DISCOVERY_TIMEOUT_MS` (padrao `120000`, aceito entre `1000` e `600000`): limite total da descoberta de impressoras; cancelamento fecha conexoes de rede e interrompe sondas seriais.
- `PRINTFLOW_AGENT_CONNECT_TIMEOUT_MS` (padrao `30000`), `PRINTFLOW_AGENT_STATUS_TIMEOUT_MS` (padrao `30000`), `PRINTFLOW_AGENT_CONTROL_TIMEOUT_MS` (padrao `15000`), `PRINTFLOW_AGENT_DISCONNECT_TIMEOUT_MS` (padrao `15000`) e `PRINTFLOW_AGENT_START_PRINT_TIMEOUT_MS` (padrao `180000`): limites centralizados por operacao de adapter.
- `FILA_AGENT_WS_POLL_MS` (`PRINTFLOW_AGENT_WS_POLL_MS` como alias legado; padrao/minimo `90000`/`60000`) e `FILA_AGENT_SSE_POLL_MS` (`PRINTFLOW_AGENT_SSE_POLL_MS` como alias legado; padrao/minimo `45000`/`30000`): polling de seguranca enquanto WebSocket ou SSE estao conectados; sem realtime o polling usa backoff ate `30000` ms. O agendamento recebe jitter de aproximadamente 10% para espalhar consultas entre Agents.
- `PRINTFLOW_AGENT_SHUTDOWN_TIMEOUT_MS` (padrao `20000`): limite do encerramento gracioso.
- `PRINTFLOW_PRINT_EVENT_WAIT_MS` (padrao `15000`): quanto o monitor aguarda um status normalizado antes de consultar a impressora como fallback.

## Concorrencia e recuperacao

Comandos chegam do Cloud por polling/realtime e entram em um dispatcher local com pools separados para impressoras e slicing. Comandos da mesma impressora preservam a ordem; impressoras diferentes podem executar em paralelo ate `MAX_CONCURRENT_PRINTER_COMMANDS`. O `PrinterManager` tambem serializa operacoes fisicas por chave estavel e compartilha uma conexao em andamento para chamadas simultaneas.

Operacoes dos adapters recebem um `AbortSignal` e um timeout central. Os adapters HTTP OctoPrint, Moonraker e PrusaLink propagam o sinal ao Axios; protocolos/bibliotecas que nao aceitam cancelamento podem terminar em background, mantendo o lock daquela impressora ate a Promise original finalizar. A falha fica registrada no health local e o restante das impressoras continua trabalhando.

Falhas consecutivas degradam a saude por impressora e abrem um circuito para novas conexoes por um backoff exponencial com jitter e teto de 60 segundos. Uma operacao bem-sucedida limpa as falhas consecutivas.

Eventos e metricas locais usam retry individual com backoff, classificacao de respostas 4xx permanentes e dead-letter apos o limite configurado. Uma falha nao interrompe o restante do lote. Conclusoes de comandos permanecem persistidas e tambem usam retry agendado para nao bloquearem outros itens.

`SIGINT` e `SIGTERM` param novas buscas, timers e realtime, drenam comandos, tentam sincronizar filas, desconectam adapters e fecham o servidor local e SQLite dentro do timeout configurado. O endpoint local de diagnostico inclui versoes/runtime, conectividade do backend, modo realtime, estado SQLite, uso agregado do cache (contagem/tamanho/pins/temporarios), contagens/outbox dead-letter e health de impressoras; ele continua protegido pelo token local e sanitiza campos sensiveis. O heartbeat envia um snapshot agregado, sem identificadores de impressora nem segredos; o Backend normaliza e mantém o último snapshot por Agent para a visão de integrações.

O barramento interno publica eventos normalizados de conexao e mudanca de status/progresso pelo `PrinterManager`, sem payloads crus nem credenciais. O MQTT da Bambu tambem publica telemetria diretamente no barramento, com remocao do listener no disconnect. O Production Job Monitor consome esses eventos quando disponiveis e consulta o adapter apos `PRINTFLOW_PRINT_EVENT_WAIT_MS` sem evento. Moonraker WebSocket e eventos nativos de plugins OctoPrint ainda nao estao ligados; o polling de reserva continua necessario para eles, PrusaLink e Marlin.

Durante a descoberta, o Agent agrupa e envia atualizacoes limitadas ao endpoint autenticado do comando; a tela existente mescla os candidatos enquanto a busca continua. O payload aceita no maximo 50 impressoras e whitelist de campos, sem codigos ou tokens. O banco guarda apenas o progresso atual do comando, nao um historico de eventos.

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
