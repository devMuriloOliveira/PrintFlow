# Agent: testes e releases

## Testes oficiais

Na pasta `Agent`:

```bat
npm.cmd test
```

Esse comando verifica sintaxe Node e executa os testes em `Agent/test`. Os contratos C# do runtime ficam em `Agent/windows-runtime-tests` e os E2Es nativos ficam em `Agent/test/windows-native-install-e2e.mjs` e `Agent/test/windows-signed-update-e2e.mjs`.

Para testar a rejeição de um ZIP alterado pelo Setup nativo, construa um pacote local de teste e execute, na pasta `Agent`:

```bat
npm.cmd run test:package-integrity-e2e -- dist\audit-0.1.35\Fila-Agent-Test-Setup.exe dist\audit-0.1.35\Fila-Agent-Test.zip
```

Esse E2E usa apenas diretórios temporários `FilaAgent-E2E-*` em `%LOCALAPPDATA%`; verifica que o Setup rejeita o ZIP modificado antes de alterar uma pasta sentinela existente e remove os arquivos temporários ao concluir. Não use esse teste contra instalações ou pacotes de produção.

O E2E completo de instalação também exige que nenhum host `FilaAgent.exe` ou `PrintFlowAgentHost.exe` esteja ativo, pois o Agent usa um mutex único por sessão do Windows. O teste agora falha antes de criar tarefas ou iniciar processos, sem encerrar um host existente, e exige permissão para consultar a lista de processos do Windows. Feche o Agent manualmente quando for seguro e execute novamente para validar o ciclo completo.

## O que a suíte cobre

- armazenamento e proteção de credenciais;
- servidor local e saúde;
- descoberta, adapters e comandos de impressoras;
- fila, eventos, métricas e retomada;
- slicing e integração Orca;
- contratos do setup, atualização, release e bundle de suporte;
- instalação isolada, rollback, reinício e desinstalação no E2E disponível.

## O que a suíte não comprova sozinha

- instalação em todos os perfis Windows;
- impressora física e todas as versões de firmware/API;
- confiança do certificado em clientes externos;
- release publicada ou comportamento no GitHub/Vercel/Render;
- atualização em uma instalação de usuário real;
- banco, API e credenciais de produção.

## Empacotamento

O script `build:windows` chama o ReleaseTool C# para construir e validar o pacote. Builds assinados, publicação e transição de certificado são operações separadas e devem registrar artefato, hash, versão, ambiente e evidência de publicação.

## Evidência de conclusão

Uma alteração do Agent só deve ser marcada como validada quando o teste exercitar o caminho alterado. Build sem execução do fluxo de instalação, atualização ou desinstalação registra apenas compilação, não comportamento completo.
