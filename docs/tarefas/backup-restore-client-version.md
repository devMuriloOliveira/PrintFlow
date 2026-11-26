# Alinhar clientes PostgreSQL no teste de restauração

## Estado

Aguardando validação

## Data

2026-11-26

## Objetivo e escopo

Corrigir a falha do job `backup-restore-integration`, no qual `pg_restore` enviou `SET transaction_timeout` ao serviço PostgreSQL 16. O escopo limita-se à versão das ferramentas PostgreSQL usadas pela CI e ao registro técnico. Não altera a implementação de backup/restauração, o esquema, dados ou ambientes hospedados.

## Linha de base

Na execução CI `45859240943`, o serviço era `postgres:16`, mas o runner `ubuntu-latest` já resolvia para Ubuntu 26.04 e `apt-get install postgresql-client` instalou a versão 18 (`18+290ubuntu1`). O restore falhou com `unrecognized configuration parameter "transaction_timeout"`, configuração introduzida no PostgreSQL 17. As notas oficiais dos runners identificam PostgreSQL 18 em Ubuntu 26.04; por isso o job agora fixa Ubuntu 24.04 e solicita o cliente 16 explicitamente.

## Alterações

- `.github/workflows/ci.yml`: fixa o runner em Ubuntu 24.04, instala `postgresql-client-16`, verifica as ferramentas da versão 16 e define `PG_DUMP_BIN=pg_dump-16` e `PG_RESTORE_BIN=pg_restore-16` para o teste.
- `docs/backend/persistence-and-integrations.md`: registra o alinhamento de versão entre ferramentas e servidor do teste.

## Critérios de aceitação

- [x] O workflow seleciona ferramentas PostgreSQL 16 explicitamente para o serviço PostgreSQL 16.
- [ ] O job remoto `backup-restore-integration` restaura o dump e valida os dados sem erro.

## Verificações executadas

| Verificação | Comando ou procedimento | Resultado |
| --- | --- | --- |
| Teste focado | `npm.cmd run test:backup-restore` em `BackEnd` | Guarda local passou; teste real foi ignorado por ausência de PostgreSQL local isolado e confirmação explícita. |
| Suíte Backend | `npm.cmd test` em `BackEnd` | 213 passaram, 1 ignorado, 0 falhas. |
| Diff | `git diff --check` | Passou. |

## O que continua pendente

- Aguardar a execução da CI após envio da alteração para confirmar o restore real no PostgreSQL 16.
- Não foi possível reproduzir localmente porque este ambiente não disponibiliza Docker, `pg_dump` ou `pg_restore`.

## Risco e impacto

- Dados: nenhum banco foi criado ou alterado nesta validação local.
- Produção/publicação: nenhum deploy ou operação em banco hospedado.
- Reversão: reverter a alteração isolada do job em `.github/workflows/ci.yml`.
- Risco residual: até o job remoto passar, o comportamento ponta a ponta permanece não validado.

## Encerramento

A configuração está implementada e a suíte local do Backend passou. O registro permanece aguardando validação porque o teste de integração depende do PostgreSQL 16 real no CI.

## Referências oficiais

- [PostgreSQL 17 release notes: `transaction_timeout`](https://www.postgresql.org/docs/17/release-17.html)
- [PostgreSQL 16 `pg_dump`: compatibilidade entre versões principais](https://www.postgresql.org/docs/16/app-pgdump.html)
- [GitHub Actions runner images: Ubuntu 26.04](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md)
