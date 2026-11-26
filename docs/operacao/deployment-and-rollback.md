# Operação: publicação e reversão

## Mapa de hospedagem

| Componente | Hospedagem documentada | Verificação necessária |
| --- | --- | --- |
| FrontEnd | Vercel | versão publicada, login e fluxos autenticados |
| AdminFrontEnd | hospedagem separada, conforme configuração do projeto | acesso administrativo e auditoria |
| BackEnd | Render | `/healthz`, logs, migrações, jobs e API autenticada |
| PostgreSQL | Neon | backup recuperável, migrações e isolamento |
| Arquivos | Cloudflare R2 em produção | upload, download, retenção e credenciais |
| Agent | release Windows | assinatura, instalação, atualização e desinstalação |

## Antes de publicar

- confirmar branch, commit e artefatos que serão publicados;
- executar os checks do componente afetado;
- confirmar variáveis e origens CORS sem expor valores;
- verificar backup recuperável antes de migração ou alteração de dados;
- separar prova local, prova de artefato e prova do ambiente publicado;
- definir como reverter a versão e quem autoriza a operação.

## Reversão

Reversão de frontend deve apontar a hospedagem para um artefato anterior conhecido. Reversão de Backend exige avaliar migrações e compatibilidade de dados antes de trocar a versão. Restauração de banco é manual e destrutiva para a base informada; não deve ser executada sem confirmação explícita do alvo e do backup.

No Agent, atualização deve preservar a instalação anterior até health check e validações passarem; a desinstalação e o rollback não devem apagar dados por padrão.

## Limites

Push, build local e CI verde não comprovam publicação, configuração correta de serviços externos, cobrança, RLS, webhooks ou hardware. A validação publicada precisa ser registrada separadamente em uma tarefa ou auditoria.
