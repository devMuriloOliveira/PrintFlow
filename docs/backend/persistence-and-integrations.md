# Backend: persistência, arquivos e integrações

## PostgreSQL

O PostgreSQL é a fonte oficial dos dados de negócio. `src/db/pool.js` gerencia a conexão e `src/db/migrate.js` contém as migrações do projeto. O servidor executa migrações na inicialização, então o ambiente precisa ser confirmado antes de iniciar.

Seeds e limpeza de demonstração aceitam somente hosts locais (`localhost`, `127.0.0.1` ou `::1`). O backup usa `pg_dump`; restauração é manual e substitui dados na base indicada, exigindo confirmação explícita.

O teste de restauração da CI fixa o runner em Ubuntu 24.04, mantém o serviço PostgreSQL 16 e instala/chama `pg_dump-16`/`pg_restore-16` explicitamente. O cliente deve acompanhar a versão principal do servidor de destino: clientes mais novos podem gerar comandos que versões anteriores não reconhecem. O runner `ubuntu-latest` migrou para Ubuntu 26.04, cujo pacote padrão observado na CI era PostgreSQL 18.

## Arquivos de impressão

O banco guarda metadados, como nome, formato, hash, tamanho e chave de armazenamento. O conteúdo do arquivo usa o provider local em desenvolvimento ou R2 em produção. O serviço valida tamanho, extensão/formato, hash, produto, impressora, material, fila e tenant antes do envio ao Agent.

## Integrações externas

- Cloudflare R2: armazenamento de objetos em produção.
- Mercado Livre: OAuth PKCE e operações de marketplace.
- Mercado Pago: checkout, assinatura e webhooks verificados.
- Stripe: configuração privada para operações de cobrança existentes.
- Resend: verificação de e-mail e recuperação de senha.
- Fila Agent: pareamento, heartbeat, comandos, progresso e métricas de impressão.

Tokens, códigos de autorização, secrets de webhook e chaves de storage não entram em documentação ou logs.

## Jobs e saúde operacional

O Backend inicia watchdogs para fila de impressão, saúde do Agent, assinaturas, despesas recorrentes e eventos operacionais. O endpoint público `/healthz` deve ser usado por monitoramento externo; o resumo operacional autenticado é restrito.

## Limitações verificadas

Os testes locais usam simuladores, fixtures e providers locais quando possível. Ainda exigem validação separada: R2 real, OAuth real, webhooks assinados, Mercado Pago em ambiente autorizado, backup restaurável em destino real e comportamento sob carga de homologação.
