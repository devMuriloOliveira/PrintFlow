# Auditoria do Agent: runtime, impressoras e OrcaSlicer

Este índice reúne a migração do runtime C#, adapters de impressoras, descoberta, slicing e verificações do OrcaSlicer. O histórico integral contém os comandos e limites de cada prova.

## Roteiro de leitura

- [Auditoria ampliada de slicer, descoberta e conexões](./FILA-AGENT-MIGRATION-AUDIT.md#auditoria-ampliada-runtime-slicer-descoberta-conexões-e-powershell)
- [Smoke local com Orca real](./FILA-AGENT-MIGRATION-AUDIT.md#smoke-local-com-orca-real--2026-10-07)
- [Provisionamento do Orca](./FILA-AGENT-MIGRATION-AUDIT.md#decisão-de-provisionamento-orca---2026-10-07)
- [Fallback, monitor e eventos C#](./FILA-AGENT-MIGRATION-AUDIT.md#atualização-do-fallback-orca-monitor-e-eventos-c---2026-10-08)
- [Descoberta de impressoras no dispatcher C#](./FILA-AGENT-MIGRATION-AUDIT.md#descoberta-de-impressoras-no-dispatcher-c---2026-10-07)
- [Validação TLS Bambu](./FILA-AGENT-MIGRATION-AUDIT.md#validacao-de-certificados-tls-bambu--2026-10-09)
- [Conexão Ender/Marlin](./FILA-AGENT-MIGRATION-AUDIT.md#revalidação-da-conexão-ender-marlin--2026-10-09)

## Limites

Mocks, smoke de slicing e contratos C# não comprovam operação com impressora física, firmware específico ou API externa em produção. Essas limitações permanecem válidas mesmo quando o pacote local é construído com sucesso.
