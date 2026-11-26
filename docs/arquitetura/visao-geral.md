# Visão geral da arquitetura

## Escopo

O Filamind é composto por duas aplicações web independentes, uma API Node.js e um Agent opcional para Windows. A API e o banco PostgreSQL são a fonte oficial dos dados de negócio.

## Componentes

| Componente | Responsabilidade | Ambiente principal |
| --- | --- | --- |
| `FrontEnd` | Painel do cliente em Nuxt/Vue | Vercel |
| `AdminFrontEnd` | Portal interno administrativo em Nuxt/Vue | Vercel, separado do painel do cliente |
| `BackEnd` | API, autenticação, autorização, regras de negócio e persistência | Render |
| PostgreSQL | Dados oficiais de negócio | Neon |
| Cloudflare R2 | Armazenamento de arquivos | Cloudflare R2 |
| `Agent` | Ponte local entre o navegador/API e impressoras Windows | Computador do usuário |

## Limites de responsabilidade

- O Backend resolve a identidade do tenant a partir da sessão/token e aplica o isolamento ao acesso aos dados.
- O Agent comunica-se com a API e não acessa o PostgreSQL diretamente.
- O Agent não recebe `DATABASE_URL` e não é fonte de verdade para registros comerciais.
- O frontend exibe e solicita operações; a autorização real permanece no Backend.
- O AdminFrontEnd é separado do painel do cliente e não substitui a autorização do servidor.
- O serviço local do Agent escuta em `127.0.0.1:17873` para integração controlada com o navegador.

## Fluxo operacional resumido

1. O usuário acessa o `FrontEnd` e autentica-se pela API.
2. O Backend valida tenant, permissões e regras antes de persistir uma operação.
3. Arquivos pesados são armazenados no R2; os metadados e relações permanecem no Backend/PostgreSQL.
4. Para impressoras locais, o Backend cria comandos para o Agent.
5. O Agent busca comandos, executa a ação na impressora e retorna status, resultado e heartbeat.
6. O frontend consulta o Backend para apresentar o estado consolidado.

## Ambientes e publicação

O trabalho local deve usar desenvolvimento e banco local ou de homologação. A publicação oficial usa Vercel para os frontends, Render para o Backend, Neon para PostgreSQL e Cloudflare R2 para arquivos. Este documento não comprova que uma versão esteja publicada ou funcionando em produção; essa confirmação exige uma verificação específica de release.

## Integrações de impressoras

O Agent possui adapters para Bambu Lab, Marlin/serial, OctoPrint, Moonraker/Klipper e PrusaLink. A cobertura local é maior para Bambu e Marlin/mock. Operação com hardware físico e versões reais das APIs continua dependente de validação própria.

## Fonte de verdade e riscos

O Backend/PostgreSQL é a fonte oficial dos dados de negócio. Alterações no schema, autenticação, autorização, contabilidade, pagamentos ou dados de produção exigem uma tarefa própria, revisão de impacto e aprovação específica.

## Referências

- [Índice da documentação](../README.md)
- [README do repositório](../../README.md)
- [Instruções de desenvolvimento](../../AGENTS.md)
- [README do Backend](../../BackEnd/README.md)
- [README do Frontend](../../FrontEnd/README.md)
- [README do AdminFrontEnd](../../AdminFrontEnd/README.md)
- [README do Agent](../../Agent/README.md)
