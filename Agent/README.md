# PrintFlow Agent

Programa local para Windows que conecta o PrintFlow as impressoras 3D do usuario. Ele roda no computador do usuario, aparece na bandeja do sistema e executa comandos enviados pelo BackEnd.

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

O Agent salva dados locais em um diretorio proprio. Por padrao, usa a pasta `data` dentro do Agent, ou o diretorio definido por `PRINTFLOW_AGENT_DATA_DIR`.

Arquivos locais principais:

- `agent.json`: credencial de pareamento do Agent.
- `printer-credentials.json`: credenciais de impressoras salvas localmente.
- cache de arquivos de impressao baixados.

As credenciais de impressora sao armazenadas criptografadas localmente. Elas nao devem ser copiadas para README, logs ou telas do usuario.

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

```powershell
npm.cmd install
$env:PRINTFLOW_API_URL="http://localhost:3333"
npm.cmd run start
```

Teste com Bambu simulada:

```powershell
$env:PRINTFLOW_DEV_MOCK_BAMBU="true"
npm.cmd run start
```

O mock permite validar descoberta, conexao, status, pausa, retomada, cancelamento, desconexao e reconexao sem impressora fisica.

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

## Gerar Pacote Windows

```powershell
npm.cmd run build:windows
```

O pacote final e gerado em:

```text
Agent/dist/PrintFlow-Agent-Windows.zip
```

Depois de extraido, o instalador copia o Agent para `%LOCALAPPDATA%\PrintFlowAgent`, registra a inicializacao no login, cria atalhos e registra o protocolo local.

## Variaveis de Ambiente

- `PRINTFLOW_API_URL`: URL da API do PrintFlow.
- `PRINTFLOW_PAIRING_CODE`: codigo temporario usado no pareamento automatico.
- `PRINTFLOW_AGENT_DATA_DIR`: diretorio local de dados e credenciais.
- `PRINTFLOW_AGENT_LOG_DIR`: diretorio local dos logs.
- `PRINTFLOW_DEV_MOCK_BAMBU`: ativa impressora Bambu simulada quando `true`.

Nao use valores reais de producao nos exemplos do README.

## Testes

```powershell
npm.cmd test
```

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

