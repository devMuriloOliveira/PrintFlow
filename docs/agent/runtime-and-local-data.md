# Agent: runtime e dados locais

## Execução local

O runtime instalado é C#/.NET 8. Node permanece no repositório para testes de paridade, ferramentas de suporte e runtime de referência; ele não é incluído no pacote Windows atual.

No CMD, a partir de `Agent`:

```bat
npm.cmd ci
set FILA_AGENT_ENVIRONMENT=DEVELOPMENT
set FILA_AGENT_API_URL=http://localhost:3333
set FILA_AGENT_DATA_DIR=%LOCALAPPDATA%\FilaAgent-Teste
npm.cmd run start
```

O mock Bambu pode ser habilitado com `FILA_AGENT_DEV_MOCK_BAMBU=true`. O endpoint local de saúde é `http://127.0.0.1:17873/healthz`; ele não comprova heartbeat recebido pelo Backend nem operação em hardware.

## Dados locais

O diretório ativo é `%APPDATA%\Fila Agent` em instalações novas, ou `%APPDATA%\PrintFlow Agent` durante compatibilidade legada. `FILA_AGENT_DATA_DIR` tem precedência e `PRINTFLOW_AGENT_DATA_DIR` é alias legado.

Arquivos principais:

- `agent.json`: credencial de pareamento protegida por DPAPI;
- `printer-credentials.json`: credenciais locais de impressoras protegidas;
- `agent-operations.sqlite`: comandos, confirmações, outbox e estado local;
- `cache/files` e `cache/gcode`: arquivos temporários;
- `logs`: registros locais;
- `diagnostics.token`: token temporário protegido para diagnóstico local.

Esses arquivos podem conter credenciais, histórico operacional ou identificadores privados. Não devem entrar no Git, em anexos ou em screenshots. O pacote de suporte deve ser gerado pelo helper existente, que remove credenciais e recusa sobrescrever um arquivo existente.

## Impressoras e slicing

Há adapters para Bambu Lab, Marlin/USB, OctoPrint, Moonraker/Klipper e PrusaLink. O slicing com Orca é local, valida o modelo e o perfil antes de gerar o arquivo; o resultado não inicia uma impressão por si só. Bambu e Marlin/mock têm maior cobertura local, enquanto hardware real e versões reais de APIs ainda exigem validação específica.
