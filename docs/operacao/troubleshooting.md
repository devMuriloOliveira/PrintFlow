# Operação: diagnóstico

## API

1. Confirmar que o Backend iniciou com banco local ou autorizado.
2. Consultar `GET /healthz` sem usar dados autenticados.
3. Conferir `PORT`, `DATABASE_URL` e `CORS_ALLOWED_ORIGINS` no ambiente correto.
4. Verificar logs de migração e jobs de inicialização.
5. Para rotas protegidas, confirmar sessão, tenant e autorização antes de interpretar a resposta.

## Frontends

1. Confirmar `NUXT_PUBLIC_API_BASE` antes de iniciar o Nuxt.
2. Conferir a origem do painel na configuração CORS do Backend.
3. Separar falha de compilação, falha de rede, falha de autenticação e falha de autorização.
4. Não usar o mock visual como prova de persistência ou integração real.

## Agent

1. Consultar `http://127.0.0.1:17873/healthz` para verificar o serviço local.
2. Confirmar o diretório de dados ativo e não copiar `agent.json`, cofres ou tokens para anexos.
3. Conferir versão, API configurada, pareamento e heartbeat separadamente.
4. Usar bundle de suporte sanitizado quando necessário.
5. Não iniciar instalação, atualização ou desinstalação normal sem preservar evidências e confirmar o alvo.

## Registro do diagnóstico

Toda investigação deve registrar data, versão/commit, ambiente, comando ou procedimento, resultado observado, dados não acessados, hipótese confirmada ou descartada e próximo passo. Segredos, tokens e dados pessoais não entram no registro.
