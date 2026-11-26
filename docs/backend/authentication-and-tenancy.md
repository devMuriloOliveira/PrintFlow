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
