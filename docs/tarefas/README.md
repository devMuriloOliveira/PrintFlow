# Tarefas e pendências

Área reservada para backlog, pendências verificadas, decisões abertas e critérios de conclusão. O controle de execução ficará nesta área, junto da documentação permanente.

## Ciclo de uma tarefa

Toda tarefa de correção, melhoria ou documentação deve seguir estes estados:

1. **Proposta** — objetivo, escopo, não objetivos, risco e arquivos prováveis estão descritos.
2. **Em andamento** — a linha de base foi observada e a implementação está sendo feita.
3. **Aguardando validação** — a alteração foi feita, mas ainda falta executar ou revisar alguma verificação.
4. **Validada localmente** — os critérios definidos passaram no ambiente local, com comandos e resultados registrados.
5. **Pronta para publicação** — a validação local terminou, mas ainda não houve publicação ou teste no ambiente hospedado.
6. **Publicada** — a alteração foi implantada no ambiente autorizado e essa evidência foi registrada.
7. **Encerrada** — não há pendência relacionada dentro do escopo; riscos residuais e limitações continuam documentados.

Uma tarefa pode voltar para **Em andamento** se a validação revelar um bug, comportamento incompleto ou uma hipótese incorreta. A tarefa não deve ser marcada como encerrada apenas porque compilou.

## Registro obrigatório ao concluir

Cada tarefa concluída deve registrar:

- objetivo e escopo real;
- arquivos e superfícies alterados;
- comportamento implementado;
- critérios de aceitação;
- comandos de teste e resultado observado;
- validação manual ou E2E, quando aplicável;
- testes não executados e motivo;
- bugs ou ajustes restantes;
- risco residual;
- impacto em dados, produção, publicação e reversão;
- documento técnico relacionado, quando a tarefa alterar um fluxo existente.

## Onde registrar cada resultado

| Resultado | Registro |
| --- | --- |
| Tarefa comum ou melhoria | `docs/tarefas/` |
| Bug reproduzido e corrigido | tarefa original e auditoria do escopo afetado, quando existir |
| Alteração do Agent | `docs/agent/` e auditoria do Agent |
| Alteração de API, autenticação ou tenant | `docs/backend/` e registro de segurança quando aplicável |
| Alteração de arquitetura ou decisão difícil de reverter | `docs/arquitetura/decisoes/` |
| Falha descoberta que ainda não foi corrigida | `docs/tarefas/pendencias.md`, com evidência e próximo passo |

## Regra de validação

O registro deve diferenciar claramente:

- **implementado:** o código foi alterado;
- **validado:** o comportamento foi exercitado por um teste ou verificação apropriada;
- **publicado:** a alteração chegou ao ambiente oficial;
- **não verificado:** ainda depende de produção, hardware, credencial, serviço externo ou revisão manual.

Quando uma validação falhar, o resultado deve permanecer registrado. A tarefa só avança depois que o problema relacionado for corrigido ou explicitamente convertido em pendência com responsável, evidência e próximo passo.

## Modelo de registro

Use o [modelo de tarefa](./task-record-template.md) para novos registros. O modelo é um guia; não substitui a auditoria específica de cada área.

## Arquivos de acompanhamento

- [Backlog documental](./backlog.md)
- [Pendências verificadas](./pendencias.md)
- [Plano de organização](./plan.md)
- [Checklist de execução](./todo.md)
