# Alinhar clientes PostgreSQL no teste de restauração

## Estado

Encerrada

## Data

2026-11-26

## Objetivo e escopo

Corrigir a falha do job `backup-restore-integration`, no qual `pg_restore` enviou `SET transaction_timeout` ao serviço PostgreSQL 16. O escopo limita-se à versão das ferramentas PostgreSQL usadas pela CI e ao registro técnico. Não altera a implementação de backup/restauração, o esquema, dados ou ambientes hospedados.

## Linha de base

Na execução CI `45859240943`, o serviço era `postgres:16`, mas o runner `ubuntu-latest` já resolvia para Ubuntu 26.04 e `apt-get install postgresql-client` instalou a versão 18 (`18+290ubuntu1`). O restore falhou com `unrecognized configuration parameter "transaction_timeout"`, configuração introduzida no PostgreSQL 17. As notas oficiais dos runners identificam PostgreSQL 18 em Ubuntu 26.04; por isso o job agora fixa Ubuntu 24.04 e solicita o cliente 16 explicitamente.

## Alterações

- `.github/workflows/ci.yml`: fixa o runner em Ubuntu 24.04, instala `postgresql-client-16`, verifica os binários versionados e define seus caminhos absolutos em `PG_DUMP_BIN` e `PG_RESTORE_BIN`.
- `docs/backend/persistence-and-integrations.md`: registra o alinhamento de versão entre ferramentas e servidor do teste.

## Critérios de aceitação

- [x] O workflow seleciona ferramentas PostgreSQL 16 explicitamente para o serviço PostgreSQL 16.
- [x] O job remoto `backup-restore-integration` restaura o dump e valida os dados sem erro.

## Verificações executadas

| Verificação | Comando ou procedimento | Resultado |
| --- | --- | --- |
| Teste focado | `npm.cmd run test:backup-restore` em `BackEnd` | Guarda local passou; teste real foi ignorado por ausência de PostgreSQL local isolado e confirmação explícita. |
| Suíte Backend | `npm.cmd test` em `BackEnd` | 213 passaram, 1 ignorado, 0 falhas. |
| Diff | `git diff --check` | Passou. |
| CI após primeiro ajuste | [execução 45862104443](https://github.com/devMuriloOliveira/PrintFlow/actions/runs/45862104443) | Instalação do cliente 16 passou; verificação falhou porque `pg_dump-16` não existe no `PATH`; teste de restore não iniciou. |
| CI final | [execução 45862390256](https://github.com/devMuriloOliveira/PrintFlow/actions/runs/45862390256) | `pg_dump`/`pg_restore` 16.16; `test:backup-restore` passou 2/2, incluindo restauração e integridade do fixture. |

## O que continua pendente

- Não foi possível reproduzir localmente porque este ambiente não disponibiliza Docker, `pg_dump` ou `pg_restore`.
- O job separado `agent-production-package` ainda estava em andamento no momento deste registro; ele não participa da validação de backup/restauração.

## Risco e impacto

- Dados: nenhum banco foi criado ou alterado nesta validação local.
- Produção/publicação: nenhum deploy ou operação em banco hospedado.
- Reversão: reverter a alteração isolada do job em `.github/workflows/ci.yml`.
- Risco residual: nenhum risco remanescente no teste PostgreSQL 16 identificado; a execução geral ainda aguardava o job independente de pacote do Agent.

## Encerramento

A correção está implementada, enviada à branch de release e validada pelo job remoto em PostgreSQL 16.16. A primeira repetição no commit `e1d9fb9` confirmou a instalação do pacote 16, mas mostrou que `pg_dump-16` não é exposto pelo `PATH`; o commit `502bdd2` ajustou para usar os caminhos versionados `/usr/lib/postgresql/16/bin/pg_dump` e `/usr/lib/postgresql/16/bin/pg_restore`. A execução `45862390256` confirmou a restauração e integridade dos dados descartáveis.

## Referências oficiais

- [PostgreSQL 17 release notes: `transaction_timeout`](https://www.postgresql.org/docs/17/release-17.html)
- [PostgreSQL 16 `pg_dump`: compatibilidade entre versões principais](https://www.postgresql.org/docs/16/app-pgdump.html)
- [GitHub Actions runner images: Ubuntu 26.04](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md)
