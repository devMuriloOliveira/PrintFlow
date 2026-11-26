# Tarefa: clareza visual do Setup e desinstalador do Fila Agent

## Estado

Aguardando validação

## Data

2026-11-26

## Objetivo e escopo

Melhorar a leitura das janelas nativas de instalação e desinstalação, com foco na hierarquia visual, legibilidade em escala comum do Windows e explicação da escolha sobre os dados locais. Preservar a regra atual: a desinstalação mantém os dados por padrão e só os remove após escolha explícita.

Fora do escopo: alterar o fluxo técnico de instalação/desinstalação, assinatura/certificados, comportamento de atualização, conteúdo jurídico dos Termos, dados, serviços ativos e publicação.

## Linha de base

`SetupConsentForm.cs` já mostra os Termos e exige aceite quando aplicável. `UninstallConsentForm` usa janela fixa de 520 × 260; o texto explicativo e a opção de exclusão dos dados ficam próximos e podem quebrar linha sem hierarquia visual. O código de remoção apaga `%APPDATA%\Fila Agent` e `%APPDATA%\PrintFlow Agent` apenas quando a opção é marcada.

## Plano e critérios de aceitação

- [x] Reorganizar a janela de desinstalação em blocos visuais: aplicativo/versão, dados preservados por padrão e opção explícita de exclusão.
- [x] Ajustar microcopy para indicar sem ambiguidade o que será removido e que deixar a opção desmarcada preserva os dados.
- [x] Ajustar espaçamento, dimensionamento e ordem dos controles no diálogo de instalação sem alterar o aceite dos Termos.
- [x] Preservar tabulação, botões padrão/cancelar e a opção de apagar dados desmarcada por padrão.
- [x] Executar contratos C# focados e build Release do Setup.
- [ ] Inspecionar manualmente os diálogos em Windows interativo, incluindo escalas/DPI distintas.

## Arquivos previstos

- `Agent/windows-setup/SetupConsentForm.cs`
- `Agent/windows-runtime-tests/Program.cs` (contrato de comportamento visual/microcopy, se aplicável)
- `docs/agent/updates-and-uninstall.md`
- `docs/agent/audits/FILA-AGENT-MIGRATION-AUDIT.md`

## Risco e impacto

Baixo: mudança de apresentação e texto em janelas WinForms. O risco principal é corte de conteúdo em escala de tela/DPI diferente. Nenhum impacto em dados, produção ou publicação; mudanças não devem ser instaladas em máquina de usuário nesta tarefa.

## Verificações

`node --test test/windows-installer-contract.test.js` passou 21/21. `dotnet build windows-setup\FilaAgentSetup.csproj --configuration Release --no-restore` passou com zero avisos e erros. `git diff --check` passou. A pre-visualizacao usou um ZIP ficticio com apenas package.json. O processo mostrou a janela "Instalar Fila Agent" e um identificador de janela Windows, mas CUA.listWindows nao a enumerou e cua.getApp rejeitou o identificador. O processo foi encerrado sem aceitar os Termos nem prosseguir para instalacao; os arquivos de preview foram removidos. A inspecao visual e em diferentes DPIs permanece nao verificada.

## O que continua pendente

- Captura/inspeção visual dos diálogos em uma sessão Windows interativa e em escalas DPI distintas. CUA não enumerou a janela WinForms, então a validação precisa de uma sessão de captura compatível.
- Confirmação por pessoa usuária de que os textos refletem o nível de detalhe desejado.

## Impacto e reversão

Somente apresentação e textos locais do Setup foram alterados. Nenhuma instalação, desinstalação, dado, certificado, release ou produção foi modificado. Reversão: restaurar `SetupConsentForm.cs`, `Program.cs` e o contrato de teste deste diff; nenhum dado de usuário exige rollback.
