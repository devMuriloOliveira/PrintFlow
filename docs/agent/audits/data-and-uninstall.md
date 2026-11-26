# Auditoria do Agent: dados locais e desinstalação

Este índice reúne preservação de dados, caminhos legados, limpeza, desinstalação e segurança do auxiliar. O arquivo integral preserva a cronologia e continua sendo a evidência principal.

## Roteiro de leitura

- [Diretórios locais e licença](./FILA-AGENT-MIGRATION-AUDIT.md#diretórios-locais-e-licença)
- [Diretório de dados em instalações novas](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--diretório-de-dados-fila-agent-em-instalações-novas)
- [Limpeza seletiva dos atalhos](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--limpeza-seletiva-dos-atalhos-na-desinstalação)
- [Auditoria do ciclo de vida](./FILA-AGENT-MIGRATION-AUDIT.md#auditoria-do-ciclo-de-vida-do-instalador--2026-10-23)
- [Correções do ciclo de vida](./FILA-AGENT-MIGRATION-AUDIT.md#correções-do-ciclo-de-vida-do-instalador--2026-10-23)
- [Proteção do finalizador em teste](./FILA-AGENT-MIGRATION-AUDIT.md#proteção-do-finalizador-no-modo-de-teste--2026-11-26)

## Regra de leitura

Preservação de dados, remoção de binários e remoção opcional de dados são resultados diferentes. Cada seção deve ser lida junto das limitações do teste; o E2E isolado não substitui uma prova autorizada em uma máquina cliente.
