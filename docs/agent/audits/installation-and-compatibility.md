# Auditoria do Agent: instalação e compatibilidade

Este índice reúne as partes da auditoria histórica relacionadas a instalação, nomes, caminhos, compatibilidade legada, termos e desinstalação. O conteúdo probatório continua no [arquivo histórico integral](./FILA-AGENT-MIGRATION-AUDIT.md).

## Roteiro de leitura

- [Diretriz de marca e critérios da migração](./FILA-AGENT-MIGRATION-AUDIT.md#diretriz-de-marca-e-transição)
- [Host, atualização e empacotamento somente C#](./FILA-AGENT-MIGRATION-AUDIT.md#etapa-4--host-atualização-e-empacotamento-somente-c-implementada)
- [Nomes canônicos nos artefatos](./FILA-AGENT-MIGRATION-AUDIT.md#nomes-canônicos-fila-agent-nos-artefatos--2026-10-08)
- [Diretório de instalação para instalações novas](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--diretório-de-instalação-fila-agent-para-instalações-novas)
- [Diretório de dados e compatibilidade legada](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--diretório-de-dados-fila-agent-em-instalações-novas)
- [Limpeza seletiva dos atalhos](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--limpeza-seletiva-dos-atalhos-na-desinstalação)
- [Correções do ciclo de vida](./FILA-AGENT-MIGRATION-AUDIT.md#correções-do-ciclo-de-vida-do-instalador--2026-10-23)
- [Proteção do finalizador em teste](./FILA-AGENT-MIGRATION-AUDIT.md#proteção-do-finalizador-no-modo-de-teste--2026-11-26)

## Como interpretar

As seções históricas preservam datas, comandos e limitações de cada execução. Uma seção de instalação isolada não comprova publicação, assinatura confiável em todos os computadores ou preservação de dados em uma máquina de usuário sem o teste correspondente.
