# Backend: autenticação e isolamento por tenant

## Autenticação

O Backend controla cadastro, login, refresh, logout e consulta da sessão atual pelas rotas em `/api/auth`. O access token tem TTL configurável, com padrão documentado de 15 minutos; o refresh token tem padrão de 30 dias. Cookies, parsing do corpo, rate limit e respostas ficam nos módulos de `src/http`.

O projeto também possui fluxos de verificação de e-mail e MFA para perfis privilegiados, condicionados às variáveis de ambiente correspondentes. A ativação em produção exige preparar o domínio e o remetente no Resend e cadastrar os administradores no aplicativo autenticador.

## Resolução do tenant

O tenant é derivado da identidade autenticada. Repositórios e serviços devem limitar consultas e mutações ao tenant resolvido. Recursos pertencentes a outro tenant devem ser tratados como inexistentes quando esse for o contrato da rota.

As tabelas de dados do cliente devem possuir `tenant_id`; índices e chaves únicas devem incluir esse contexto quando necessário para impedir colisões entre empresas.

## Autorização

Autenticação confirma quem fez a requisição; autorização decide se essa identidade pode executar a operação. O Backend permanece responsável pela decisão, inclusive para o AdminFrontEnd e operações sensíveis de suporte, cobrança, privacidade e Agent.

## Dados sensíveis

Segredos de Agent, tokens, códigos de OAuth, chaves de integração e credenciais não devem ser armazenados ou registrados em texto puro. Dados sensíveis usam criptografia ou hash cego conforme o caso. Variáveis privadas só devem ser configuradas no ambiente apropriado.

## Verificação

Os testes relacionados incluem `auth-security.test.js`, `authorization.test.js`, `tenant-isolation.test.js`, `auth-email-tokens.test.js` e testes de configurações/autorização. Eles são evidência local; não comprovam uma revisão de RLS no banco de produção nem a configuração real dos provedores.

## Cadastro sem documento - 2026-11-26

O cadastro por e-mail e Google aceita CPF/CNPJ ausente. Quando o campo e preenchido, o Backend valida o documento; quando fica vazio, o tenant e criado sem `document_locked_at` para permitir o preenchimento posterior em **Configuracoes > Empresa**. O aviso aparece na tela de cadastro e nenhum schema ou dado existente foi alterado.

## Senha e entrega de e-mail - 2026-11-26

Os fluxos de recuperacao e troca de senha estao implementados. A recuperacao envia um link temporario por Resend em `/api/auth/password-reset/request`; a troca autenticada valida a senha atual, envia um codigo de uso unico com validade de 10 minutos e encerra as sessoes anteriores apos a confirmacao. Os testes locais `password-change-email.test.js` (1 aprovado) e `auth-email-tokens.test.js` (3 aprovados) confirmam esses comportamentos com o envio simulado.

As mensagens atuais sao texto simples montado no Backend, com assunto e instrucoes especificos para cada fluxo; nao existe template HTML ou editor de personalizacao. No ambiente local verificado, `RESEND_API_KEY` e `EMAIL_FROM` nao estao configurados, portanto nenhum envio real foi comprovado. `APP_PUBLIC_URL` esta configurada para um host local de tunel e deve ser revisada antes de testar links enviados a clientes.

## RLS e anexos de suporte - 2026-11-27

O ciclo de RLS em [`migrate.js`](../../BackEnd/src/db/migrate.js) passou a incluir as tabelas tenant-scoped `print_job_material_reservations`, `sales_fulfillment_plans` e `production_outputs`. As tabelas `tenant_audit_requests`, `tenant_audit_request_messages` e `tenant_audit_request_attachments` ficaram fora desta alteracao porque ainda existem caminhos administrativos legados que usam `query()` direto e precisam de migracao coordenada para `withPlatformAdmin()`. Nenhuma migracao foi executada contra banco local, staging ou producao nesta etapa.

O servico [`supportAttachments.js`](../../BackEnd/src/services/supportAttachments.js) agora valida a assinatura de PDF, PNG e JPEG e exige texto UTF-8 valido para `text/plain`, `text` e `text/csv`, mantendo o limite de tamanho e a allowlist de MIME existente. Os fluxos administrativos de anexos executam consultas dentro de `withPlatformAdmin()` para preservar o contexto exigido pelo RLS. A validacao de conteudo foi coberta por testes de rejeicao e aceitacao.

Verificacoes locais:

- `npm.cmd --prefix BackEnd test -- test/support-attachments.test.js` — 4 aprovados, 0 falhas.
- `npm.cmd --prefix BackEnd test` — 216 aprovados, 1 ignorado por exigir banco isolado para restore, 0 falhas.
- `git diff --check` — aprovado.

As verificacoes foram estaticas ou locais. O RLS real do PostgreSQL, o download atraves das rotas, o armazenamento externo e os ambientes de staging/producao nao foram exercitados. O risco residual e validar a segregacao entre tenants e o acesso de superadmin em um banco descartavel antes da publicacao.

Validacao adicional local em 2026-11-27: `npm.cmd --prefix BackEnd test -- test/db-pool-query-queue.test.js test/tenant-isolation.test.js test/production-inventory.test.js test/sales-fulfillment.test.js test/support-attachments.test.js` — 15 aprovados, 0 falhas. O ambiente nao possui `psql`, `pg_isready`, Docker ou `DATABASE_URL`; por isso a migracao e o RLS real continuam pendentes de uma instancia PostgreSQL local descartavel.

Essa limitacao foi resolvida temporariamente em um cluster PostgreSQL 18 descartavel na porta local 55432, usando o papel nao-superusuario `printflow_rls_test`. A migracao criou RLS forcado nas tres tabelas; Tenant A e Tenant B viram somente 1 linha propria em cada tabela, a atualizacao cruzada retornou 0 linhas, a insercao com `tenant_id` de outro tenant foi rejeitada pela politica e `withTenant()` retornou somente a linha do tenant selecionado. O cluster foi usado somente para dados ficticios e nao representa validacao de producao.
