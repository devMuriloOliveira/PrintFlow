# Backend: API e rotas principais

## Organização do código

- `src/server.js`: entrada do servidor HTTP.
- `src/config`: carregamento e validação de ambiente e tenant.
- `src/http`: corpo, cookies, CORS, rate limit e respostas.
- `src/routes`: handlers das rotas.
- `src/services`: regras compartilhadas, integrações e armazenamento.
- `src/repositories`: acesso por recurso.
- `src/db`: pool, migrações, seeds e operações de backup/restauração.
- `test`: testes automatizados.

## Grupos de rotas documentados

| Grupo | Exemplos |
| --- | --- |
| Autenticação | `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me` |
| Dados do aplicativo | `/api/app-data`, `/api/dashboard-summary`, `/api/reports/summary`, `/api/products`, `/api/orders`, `/api/expenses`, `/api/filaments`, `/api/printers`, `/api/marketplaces`, `/api/clients`, `/api/goals`, `/api/settings` |
| Agent | `/api/agents`, `/api/agents/pairing-code`, `/api/agents/pair`, `/api/agents/verify`, `/api/agents/heartbeat` |
| Comandos de impressora | `/api/agents/:id/discover`, `connect-printer`, `printer-status`, `printer-start`, `printer-pause`, `printer-resume`, `printer-cancel`, `printer-disconnect` |
| Cobrança | `/api/billing/mercado-pago` e operações de checkout, pausa, retomada e cancelamento |
| Webhooks | `/webhooks/mercado-pago` |
| Saúde | `/healthz` e o resumo autenticado `/api/operational-health` |

Esta é uma visão dos grupos e das rotas principais listadas na documentação e no código. Não é um contrato OpenAPI completo. Alterações de rota devem atualizar handlers, testes, clientes e documentação no mesmo trabalho.

## Contratos gerais

- Rotas de negócio devem resolver o usuário autenticado e o tenant antes de ler ou alterar dados.
- Erros e respostas usam os helpers em `src/http`.
- Operações do Agent criam comandos no Backend; o Agent executa a parte local e devolve progresso/resultado.
- Uploads de impressão validam formato, hash, tamanho, produto, impressora, material, fila e tenant antes de serem disponibilizados.
- Rotas administrativas não podem depender apenas de ocultação de menus no frontend.

## Evidência e limites

Os contratos são exercitados pelos testes em `BackEnd/test`. Uma rota que passa em teste local ainda requer verificação do ambiente hospedado quando depende de segredo, webhook, OAuth, RLS, storage externo ou serviço de pagamento.
