# Plano de organização da documentação do Filamind

## Objetivo

Separar a documentação mantida do código, organizar o conteúdo por escopo e criar um ponto de entrada único sem perder histórico, evidências ou links existentes.

## Escopo

Inclui a documentação-fonte da raiz, Backend, Frontend, AdminFrontEnd, Agent, operação e pendências. Inclui a criação de índices, critérios de manutenção e redirecionamentos nos READMEs locais.

Não inclui alterações de código, mudanças de arquitetura, migração de banco, alteração de infraestrutura, publicação, exclusão de auditoria ou movimentação de documentação gerada em `dist`, `temp`, `test-dist`, `bin` e `obj`.

## Decisões de organização

- `docs/` será a raiz da documentação mantida.
- Os escopos principais serão `arquitetura`, `backend`, `frontend`, `agent`, `operacao` e `tarefas`.
- READMEs dentro das aplicações continuarão existindo como guias rápidos e apontarão para `docs/`.
- Auditorias e decisões históricas serão preservadas; quando forem movidas, os links serão atualizados no mesmo lote.
- O controle de execução deste plano será mantido em `docs/tarefas/`, junto da documentação permanente do produto.

## Fases e critérios de aceitação

### Fase 1 — Inventário e índice central

- [x] Listar a documentação-fonte e separar artefatos gerados.
- [x] Criar `docs/README.md` com os escopos e regras.
- [x] Criar este plano e a lista de tarefas em `docs/tarefas/`.

**Aceitação:** a árvore atual continua intacta e o índice central descreve os destinos planejados.

### Fase 2 — Arquitetura geral

- [x] Criar `docs/arquitetura/`.
- [x] Consolidar limites entre Backend, banco Neon, R2, Vercel, Render e Agent.
- [x] Registrar a visão geral com base na documentação existente.
- [x] Conferir os links da documentação criada.

**Aceitação:** a arquitetura pode ser entendida sem abrir arquivos de implementação.

### Fase 3 — Backend

- [x] Criar `docs/backend/`.
- [x] Organizar API, autenticação, isolamento por tenant, persistência e integrações.
- [x] Manter o README do escopo como índice e preservar o README local como referência de execução.
- [x] Registrar limitações sem transformar hipótese em fato.

**Aceitação:** cada documento informa escopo, fonte de verdade, verificações e limitações.

### Fase 4 — Frontends

- [x] Criar `docs/frontend/`.
- [x] Separar painel do cliente e painel administrativo.
- [x] Documentar rotas, configuração, build e dependência do Backend.
- [x] Preservar a distinção de autorização entre interface e servidor.

**Aceitação:** os dois frontends têm documentação separada e não compartilham instruções ambíguas.

### Fase 5 — Agent

- [x] Criar `docs/agent/` e sua área de auditorias.
- [x] Reorganizar instalação, atualização, desinstalação, ciclo de vida e testes em guias temáticos.
- [x] Mover a auditoria existente depois de conferir referências e preservar seu histórico.
- [x] Registrar limites de validação local, publicação e produção.

**Aceitação:** nenhum achado, teste, limitação ou histórico da auditoria é perdido.

### Fase 6 — Operação e pendências

- [x] Criar `docs/operacao/` para desenvolvimento local, ambientes, publicação, reversão e diagnóstico.
- [x] Criar `docs/tarefas/` para backlog, pendências confirmadas e decisões abertas.
- [x] Classificar cada pendência por escopo, evidência, próximo passo e critério de conclusão.

**Aceitação:** tarefas executáveis ficam separadas de documentação descritiva e têm verificações definidas.

### Fase 7 — Redução dos READMEs locais e verificação final

- [x] Atualizar os READMEs locais com links para a documentação central.
- [x] Verificar links locais e referências a caminhos antigos.
- [x] Executar as verificações documentais relevantes.
- [x] Conferir `git diff --check` e a árvore final.

**Aceitação:** a documentação central é navegável, os READMEs locais continuam úteis e nenhum código foi alterado por engano.

## Riscos e controles

| Risco | Impacto | Controle |
| --- | --- | --- |
| Link relativo quebrado após mover auditorias | Médio | Criar o destino antes de mover e verificar referências no mesmo lote |
| Perda de histórico documental | Alto | Preservar conteúdo integral e usar `git mv` apenas depois do inventário |
| Confundir artefato gerado com fonte | Médio | Excluir `dist`, `temp`, `test-dist`, `bin` e `obj` do inventário mantido |
| Misturar tarefa com documentação permanente | Baixo | Manter tarefas e pendências em `docs/tarefas/`, separadas por estado e finalidade |
| Alterações locais serem sobrescritas | Alto | Conferir `git status` antes de cada lote e não usar comandos destrutivos |

## Verificações por fase

- Inventário: `rg --files -g "*.md"` com diretórios gerados excluídos.
- Links: busca por caminhos antigos e conferência dos destinos existentes.
- Código: nenhum teste de código é necessário para criar índices, mas comandos documentados serão comparados aos manifests.
- Final: `git diff --check`, `git status --short` e revisão do diff documental.

## Pendências abertas

- Manter os índices temáticos da auditoria do Agent atualizados quando novas seções históricas forem acrescentadas.

## Regra aprovada para conclusão

Cada tarefa deverá ser registrada em `docs/tarefas/` com estado, linha de base, critérios de aceitação, verificações executadas, limitações, bugs restantes, risco residual e impacto de publicação. Os estados localmente implementado, validado, publicado e encerrado serão tratados separadamente. Uma falha de validação reabre a tarefa ou cria uma pendência vinculada; não será ocultada por um build bem-sucedido.
