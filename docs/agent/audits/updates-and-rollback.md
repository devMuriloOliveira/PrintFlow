# Auditoria do Agent: atualização e rollback

Este índice reúne verificações do atualizador assinado, health check, isolamento E2E, rollback e intervalos de retry. As evidências completas permanecem no [arquivo histórico integral](./FILA-AGENT-MIGRATION-AUDIT.md).

## Roteiro de leitura

- [Verificação do atualizador e proteção da instalação](./FILA-AGENT-MIGRATION-AUDIT.md#verificação-do-atualizador-e-proteção-da-instalação-existente)
- [Isolamento do E2E do atualizador](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--isolamento-do-e2e-do-atualizador-assinado)
- [Atualização isolada entre versões](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--atualização-isolada-0127-para-0128)
- [E2E do atualizador assinado](./FILA-AGENT-MIGRATION-AUDIT.md#continuação-2026-10-09--e2e-do-atualizador-assinado)
- [Correção do atualizador e preparação da 0.1.33](./FILA-AGENT-MIGRATION-AUDIT.md#correção-do-atualizador-e-preparação-da-versão-0133--2026-10-17)
- [Diagnóstico de inicialização duplicada](./FILA-AGENT-MIGRATION-AUDIT.md#diagnóstico-de-inicialização-duplicada-e-preparação-da-versão-0134--2026-10-17)
- [Correções do ciclo de vida](./FILA-AGENT-MIGRATION-AUDIT.md#correções-do-ciclo-de-vida-do-instalador--2026-10-23)

## Limites

Os registros diferenciam pacote construído, E2E isolado, release publicada e máquina cliente. Não trate uma dessas evidências como substituta das outras.
