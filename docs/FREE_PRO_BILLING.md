# FREE, PRO e billing

## Oferta comercial

- **FREE**: R$ 0, sem prazo. Organiza a operação manualmente.
- **PRO**: preço de lançamento de R$ 19,90 por mês. Conecta e automatiza a produção.
- Não há criação de trial comercial para novos checkouts. Campos e registros de trial antigos permanecem somente como histórico compatível.
- O ciclo anual permanece preservado para assinaturas existentes, mas está desabilitado para novos checkouts e alterações até nova decisão comercial.

## Configuração central

`platform_plans` é a fonte de configuração de preço, intervalos, limites e features. A migration em `BackEnd/src/db/migrate.js` configura:

| Limite FREE | Valor |
| --- | ---: |
| Clientes | 20 |
| Produtos | 10 |
| Pedidos no mês | 15 |
| Impressoras manuais | 1 |
| Filamentos | 5 |
| Metas | 1 |

Os limites são validados no backend na criação. Um downgrade não exclui registros acima do limite; apenas impede novas criações até o tenant voltar a ficar dentro do limite ou fizer upgrade.

## Entitlements e Agent

`BackEnd/src/services/subscriptionEntitlements.js` decide o acesso no servidor. O navegador não é uma fronteira de segurança.

- FREE possui operações básicas e impressora manual.
- PRO possui marketplaces, relatórios avançados, equipe e `agent`.
- Pareamento, descoberta, conexão, comandos e jobs novos exigem `agent` no backend.
- Ao perder PRO, pareamento, credenciais, histórico, heartbeat e sincronização do Agent permanecem. O polling devolve nenhum comando novo; um job físico já iniciado não recebe cancelamento automático e pode finalizar normalmente.
- O Agent usa API/HTTPS e WebSocket/WSS para Cloud; não recebe `DATABASE_URL` nem acessa PostgreSQL diretamente.

## Lifecycle financeiro

O `plan_id` representa a oferta/entitlement. `status` representa o estado financeiro; não são sinônimos.

1. Stripe confirma a assinatura e o webhook idempotente atualiza o estado local.
2. Cancelamento usa `cancel_at_period_end`; PRO fica válido até o fim pago.
3. Falha de pagamento entra em `grace`, por padrão de três dias configuráveis em `SUBSCRIPTION_GRACE_MS`.
4. Ao acabar a carência, o watchdog muda o plano local para FREE e o status para `paused`, sem apagar dados.
5. Quando Stripe informa assinatura `cancelled` ou `paused`, o plano local também volta a FREE. Assinaturas e eventos históricos são mantidos.

O watchdog não converte mais o fim de `current_period_end` em inadimplência: o provider financeiro permanece a autoridade para cobrança e cancelamento.

## Limites de validação externa

O código não define direito de arrependimento, reembolso ou textos jurídicos. Refunds precisam de política aprovada e de ação autorizada no provider. Termos, política de privacidade, bases legais, papel de controlador/operador, DPO/encarregado e retenção devem passar por validação jurídica profissional. Indicadores do PrintFlow são gerenciais, não contábeis ou fiscais.
