# Documentação do Filamind

Esta pasta reunirá a documentação mantida do projeto. O código continua nos diretórios `BackEnd`, `FrontEnd`, `AdminFrontEnd` e `Agent`; os `README.md` locais permanecem como guias rápidos e apontarão para esta documentação detalhada.

## Escopos

| Escopo | Situação | Documentação atual | Destino planejado |
| --- | --- | --- | --- |
| Arquitetura geral | Organizada | `README.md` e `AGENTS.md` na raiz | `docs/arquitetura/` |
| Backend | Organizada | `BackEnd/README.md` | `docs/backend/` |
| Frontend do cliente | Organizada | `FrontEnd/README.md` | `docs/frontend/` |
| Frontend administrativo | Organizada | `AdminFrontEnd/README.md` | `docs/frontend/` |
| Agent Windows | Guias e auditoria organizados | `Agent/README.md` e auditoria histórica | `docs/agent/` |
| Operação e publicação | Organizada | READMEs e instruções da raiz | `docs/operacao/` |
| Tarefas e pendências | Centralizada | registros e checklist | `docs/tarefas/` |

## Regras de organização

- Documentos-fonte ficam em `docs/` quando descrevem o sistema como um todo ou mais de uma aplicação.
- Cada aplicação mantém um README curto para instalação e comandos locais.
- Auditorias preservam histórico, evidências, limitações e impacto de produção.
- Tarefas registram estados, critérios, verificações e pendências; uma compilação bem-sucedida não encerra uma tarefa sem exercitar o comportamento de risco.
- Decisões arquiteturais ficam separadas de guias operacionais e listas de tarefas.
- Arquivos dentro de `dist`, `temp`, `test-dist`, `bin` e `obj` são artefatos de build ou teste e não entram na documentação mantida.
- Links antigos só são alterados depois que o destino novo existir e for conferido.

## Áreas planejadas

- [Arquitetura](./arquitetura/README.md) — visão geral, limites e decisões do sistema.
- [Backend](./backend/README.md) — API, autenticação, tenant, persistência e integrações.
- [Frontend](./frontend/README.md) — painel do cliente e portal administrativo.
- [Agent](./agent/README.md) — ciclo de vida, runtime, testes e auditorias.
- [Operação](./operacao/README.md) — desenvolvimento, publicação e diagnóstico.
- [Tarefas e pendências](./tarefas/README.md) — backlog, pendências verificadas e decisões abertas.

Os links acima apontam para a documentação mantida. O plano e o checklist em `docs/tarefas/` registram as etapas restantes.

## Fonte de verdade

Esta organização não altera contratos de API, código, banco de dados, dados de produção, hospedagem ou processo de publicação. Ela apenas define onde cada explicação será mantida e como os registros serão encontrados.
