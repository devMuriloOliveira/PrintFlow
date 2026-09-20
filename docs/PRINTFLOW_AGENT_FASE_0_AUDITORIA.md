# PrintFlow Agent — Fase 0: auditoria arquitetural

Data da auditoria: 2026-09-17. Escopo: leitura do repositório e execução de testes locais; nenhuma alteração de código, schema, dados ou infraestrutura foi feita.



## Conclusão executiva

O PrintFlow já possui a primeira ponte operacional Cloud → Agent: pareamento de identidade individual, segredo revogável, heartbeat, comandos persistidos, múltiplas impressoras por Agent, adapters, fila cloud, cache local por SHA-256 e proteção de compatibilidade antes de iniciar a impressão. Não é ainda o **Local Production Hub** pretendido. Os principais vazios são persistência operacional local (SQLite), idempotência no Agent, canal bidirecional em tempo real, sync offline, armazenamento de objetos e slicing.

A ordem de implementação priorizou a fundação do Agent antes de câmera, IA ou
novos fabricantes. O Cloudflare R2 já está definido e integrado como storage
de objetos do Backend; isso não substitui a necessidade de comandos
idempotentes e uma fila local durável.

## Limites, pressupostos e evidência

- A arquitetura de destino considera Neon PostgreSQL e Cloudflare R2. O checkout configura PostgreSQL via `DATABASE_URL` e o Backend possui provider S3/R2; o Agent não contém bucket nem credencial de storage.
- Não havia impressora, instalação de Neon, Docker/Podman ou ambiente de produção disponível. Assim, adapters HTTP, Bambu real, RLS em banco real, uploads grandes e deploys não foram exercidos.
- A fonte de verdade estrutural atual é PostgreSQL, por meio de `withTenant()`/RLS; o Agent não recebe `DATABASE_URL`, o que está alinhado ao requisito crítico.
- A implementação vigente usa a API S3 oficial do Cloudflare R2; endpoint e credenciais são configurados somente no Backend e URLs temporárias são emitidas sob autorização do tenant.

## Arquitetura atual observada

```text
Nuxt FrontEnd ──Bearer JWT──> BackEnd HTTP ──withTenant/RLS──> PostgreSQL (Neon quando configurado)
       │                              │
       │                         filesystem local do BackEnd
       │                         storage/print-files/{tenant}/{product}/{sha256}
       │                              │
       └─ painel consulta resultado    └─ comandos persistidos em agent_commands
                                          ▲                 │
PrintFlow Agent ─ x-agent-id/secret ──────┴── HTTP polling ─┘
       │
       ├─ Map de conexões em memória; adapters Bambu, Marlin, OctoPrint,
       │  Moonraker e PrusaLink
       ├─ agent.json, credenciais de impressora e cache de arquivos locais
       └─ impressoras LAN/USB
```

### Frontend → Backend → Agent

O painel Nuxt centraliza operação em `FrontEnd/app/components/impressoras/ImpressorasPage.vue`. Ele cria comandos e consulta o resultado a cada segundo por até 40 segundos; também solicita status de cada impressora vinculada em ciclo de 30 segundos. O backend grava o comando em `agent_commands`. O Agent busca um comando pendente a cada 5 segundos, marca-o `running`, o executa e chama `/complete`. Logo, hoje há polling em três camadas (painel, Agent e status), não push.

O Agent faz `POST /heartbeat` a cada 30 segundos. `agentHealthWatchdog` executa a cada 30 segundos e considera offline por padrão após 90 segundos. O watchdog de fila restaura início de impressão que ficou travado e expira comandos de início sem confirmação.

### Identidade, tenancy e segurança

Usuário autenticado cria código de pareamento de uso único com validade de 10 minutos. O backend cria/atualiza o Agent para o tenant desse código e armazena apenas SHA-256 do segredo. Cada requisição do Agent valida `x-agent-id` + `x-agent-secret`; a rota do arquivo verifica o `storageKey` contra produto do mesmo tenant. As rotas de painel usam o tenant extraído do token e consultam recursos com `tenantQuery()`.

É uma base boa, porém `Agent/src/storage/credentials.js` grava o segredo do Agent e o código pendente em JSON local sem proteção de segredo do sistema operacional. As credenciais de impressora são cifradas localmente, mas esta não substitui proteção de chave baseada no usuário/SO. Esta é prioridade de segurança da Fase 1, com migração compatível.

### Impressoras, jobs e fila

`printers` é o cadastro comercial/manual; `agents` representa uma instalação; `agent_printers` representa a ligação técnica Agent–impressora; `print_jobs` é a fila operacional cloud. Um Agent pode ter várias `agent_printers` e uma impressora pode estar ligada ao cadastro manual. O `PrinterManager` concentra a seleção de adapters e as conexões em memória, evitando `if` espalhado. O backend valida arquivo/formato, volume, material, bico, camada, preenchimento e estado da receita antes de reservar um job e emitir `start_print`.

Há constrangimento de concorrência para não iniciar dois jobs ativos na mesma impressora. Ainda não há uma entidade de trabalho local persistida, nem estado/telemetria contínua do job retornado pelo adapter.

### Arquivos e storage

O upload entra no Backend (`POST /api/products/:id/print-file`), é transmitido para filesystem do próprio backend, recebe SHA-256 e metadata fica no produto. O Agent baixa de `GET /api/agents/print-file?key=...`, portanto todo download passa pelo backend. O cache local do Agent reutiliza hash, valida integridade, expira temporários, respeita limite de bytes e remove LRU; é uma boa base parcial. Não há Range/resume, upload resumable, Object Storage, URL temporária, checksum de upload direto nem `FileManager` de domínio.

==================================================
GATE DE PUSH, PRODUÇÃO E SEGURANÇA DO REPOSITÓRIO
==================================================

Objetivo:

Todo código enviado ao GitHub deve ser automaticamente validado
como production-ready sem alterar o ambiente local de
desenvolvimento.

NÃO utilizar fluxo:

Development
→ alterar arquivos para Production
→ git push
→ alterar novamente para Development.

Esse fluxo é frágil e não deverá ser implementado.

O ambiente local deverá permanecer DEVELOPMENT.

A validação/build de PRODUÇÃO será responsabilidade do CI/CD.

==================================================
DOIS CONTEXTOS
==================================================

LOCAL:

- localhost;
- mocks permitidos;
- certificado de desenvolvimento permitido;
- debugging permitido;
- configuração local ignorada pelo Git.

CI / PRODUCTION:

- URLs oficiais;
- HTTPS/WSS;
- mocks DEV proibidos;
- secrets fornecidos externamente;
- build Production;
- validações completas.

==================================================
PRODUCTION BUILD EM TODO PUSH
==================================================

Em todo push e Pull Request aplicável:

1. checkout limpo do repositório;
2. instalar dependências usando lockfiles;
3. executar secret scanning;
4. executar verificação de arquivos proibidos;
5. executar testes Backend;
6. executar testes Agent;
7. executar build FrontEnd em modo Production;
8. validar configuração Production do Agent;
9. gerar build/package Production do Agent quando aplicável;
10. validar que nenhuma URL local entrou no artefato Production;
11. validar que nenhum mock DEV está ativo;
12. validar multi-tenancy/testes de segurança existentes;
13. falhar imediatamente se qualquer etapa falhar.

O computador do desenvolvedor deve permanecer configurado
para DEVELOPMENT durante todo o processo.

==================================================
PRODUCTION CONFIG VALIDATOR
==================================================

Criar script central de validação Production.

Exemplo:

scripts/check-production-config.mjs

Deverá rejeitar uma configuração Production que utilize:

localhost
127.0.0.1
0.0.0.0 como endpoint remoto
ws:// remoto
http:// remoto
PRINTFLOW_DEV_MOCK_BAMBU=true
certificado de desenvolvimento como certificado Production
credencial DEV como Production.

Deverá validar:

PRINTFLOW_API_URL
NUXT_PUBLIC_API_BASE
endpoint WebSocket quando houver
outras URLs críticas.

Production deverá exigir HTTPS/WSS para endpoints remotos.

Não procurar cegamente a palavra "localhost" em documentação
e testes.

A validação deve analisar a CONFIGURAÇÃO/ARTEFATO DE PRODUÇÃO,
evitando falsos positivos em README e testes.

==================================================
SEPARAÇÃO DE CONFIGURAÇÃO
==================================================

Development poderá utilizar arquivos locais como:

.env.local
.env.development.local

desde que estejam ignorados pelo Git.

Production não deverá depender de arquivos locais commitados.

Utilizar:

- GitHub Actions Variables para valores públicos;
- GitHub Actions Secrets para valores secretos;
- variáveis do provedor de hospedagem para secrets de runtime.

Nenhum secret real deve ser commitado.

==================================================
PRE-PUSH LOCAL
==================================================

Criar verificação local opcional/automática antes do push.

Ela poderá executar:

- análise rápida de arquivos staged/tracked;
- secret scan;
- arquivos proibidos;
- testes essenciais;
- configuração inválida.

Entretanto:

GitHub Actions é a autoridade final.

O pipeline não poderá depender exclusivamente de Git hooks.

==================================================
SECRET SCANNING
==================================================

Adicionar secret scanning automático ao CI.

Utilizar ferramenta consolidada, como Gitleaks, ou equivalente
adequado.

Quando forem encontrados secrets:

- falhar o CI;
- impedir merge quando status checks obrigatórios estiverem ativos;
- impedir deploy;
- impedir release;
- não imprimir o valor completo do segredo nos logs.

Quando disponível, utilizar também proteção de push do provedor Git
para impedir que secrets conhecidos sejam enviados ao repositório
remoto.

O pre-push local funciona como camada adicional.

GitHub Actions/CI continua sendo a autoridade final e não deve
depender exclusivamente do hook local.

==================================================
GITIGNORE
==================================================

Auditar e fortalecer o .gitignore.

IMPORTANTE:

Não adicionar padrões genéricos ao .gitignore cegamente.

Antes de alterar:

1. listar os arquivos atualmente rastreados;
2. identificar os diretórios runtime realmente utilizados;
3. identificar fixtures, exemplos e recursos necessários aos testes;
4. verificar se algum arquivo legítimo usa extensões normalmente
   associadas a runtime;
5. somente então adicionar regras.

Preferir regras específicas por projeto/diretório.

Por exemplo, preferir:

/Agent/.data/
/Agent/cache/
/Agent/logs/
/Agent/temp/
/Agent/dist/

em vez de ignorar genericamente qualquer diretório chamado:

data/
cache/
logs/
temp/

em todo o repositório.

Também verificar antes de ignorar globalmente:

*.db
*.zip
*.pem
*.exe

para não remover fixture/recurso legítimo do projeto.

Arquivos contendo segredo real continuam proibidos mesmo quando
necessários ao desenvolvimento.

Após auditoria, deverá impedir commit dos arquivos runtime/secret
realmente aplicáveis, incluindo quando existentes:

.env
.env.*
com exceção de exemplos explicitamente sanitizados

*.pfx
*.p12
*.pem
*.key
*.jks
*.keystore

Agent/certs/
Agent/dist/

agent.json
printer-credentials.json

*.sqlite
*.sqlite3
*.db
*.db-journal
*.db-shm
*.db-wal

data/
.data/
cache/
logs/
temp/
tmp/

node_modules/
.nuxt/
.output/
dist/
build/
coverage/

*.log
*.exe
*.msi
*.zip

Permitir arquivos de exemplo apenas quando não possuírem
credenciais reais.

Exemplo:

.env.example

==================================================
ARQUIVOS JÁ RASTREADOS
==================================================

.gitignore não remove arquivos que já foram commitados.

Auditar os arquivos atualmente rastreados.

Se arquivo que deveria ser ignorado já estiver rastreado:

- remover do índice Git mantendo cópia local quando necessário;
- verificar histórico;
- se contiver secret real, considerar comprometido;
- revogar/rotacionar credencial;
- limpar histórico quando necessário.

Não considerar apenas "apagar o arquivo atual" como correção
suficiente para um secret já publicado.

==================================================
CERTIFICADOS
==================================================

Certificado/chave privada de Code Signing nunca deverá ser
commitido.

Proibido no repositório:

private key
PFX de produção
senha de PFX
token de serviço de assinatura.

Fluxo DEV existente pode continuar para testes internos.

Fluxo de produção deverá utilizar secrets/armazenamento seguro
externo.
==================================================
ASSINATURA TEMPORÁRIA PARA EARLY ACCESS
==================================================

Enquanto não houver orçamento para um certificado Code Signing
confiável de produção, o PrintFlow poderá utilizar temporariamente
o certificado self-signed de desenvolvimento para builds destinados
a testes externos, pilotos e primeiros clientes.

Essa utilização é TEMPORÁRIA.

O certificado self-signed NÃO deve ser tratado como uma identidade
de Code Signing publicamente confiável.

O sistema deve aceitar dois modos de assinatura:

DEV_SELF_SIGNED

e futuramente:

PRODUCTION_TRUSTED

A ausência de certificado Code Signing confiável NÃO deve bloquear:

- desenvolvimento;
- installer;
- primeiros testes externos;
- primeiros clientes/pilotos;
- versionamento;
- Agent Releases;
- upgrade in-place;
- SHA-256;
- pipeline de release;
- auto-update em ambiente controlado;
- desenvolvimento das demais fases.

==================================================
COMPORTAMENTO COM CERTIFICADO SELF-SIGNED
==================================================

O installer poderá ser assinado com o certificado DEV atual enquanto
o certificado de produção não estiver disponível.

É aceitável que o Windows apresente alertas de confiança/SmartScreen
durante esse período.

Não tentar esconder ou contornar esses alertas.

Não desabilitar mecanismos de segurança do Windows.

Não instalar silenciosamente um certificado self-signed na Trusted
Root Certification Authorities do computador do cliente.

Não alterar políticas globais de segurança do Windows para tornar o
executável confiável.

Se for necessário orientar um cliente piloto sobre um alerta de
instalação, documentar claramente que se trata de um build Early
Access ainda sem certificado Code Signing público.

==================================================
MIGRAÇÃO FUTURA
==================================================

Quando um certificado Code Signing confiável estiver disponível:

- substituir o certificado utilizado pelo pipeline;
- manter o mesmo sistema de versionamento;
- manter o mesmo installer;
- manter compatibilidade com instalações existentes;
- preservar agent_id;
- preservar pareamento;
- preservar credenciais;
- preservar SQLite;
- preservar configurações;
- preservar cache necessário.

A troca de certificado NÃO deverá exigir reinstalação limpa nem novo
pareamento do Agent.

==================================================
AUTO-UPDATE DURANTE O PERÍODO SELF-SIGNED
==================================================

O sistema de atualização poderá ser desenvolvido normalmente.

Durante o período self-signed:

- validar SHA-256;
- validar que o artefato possui a assinatura esperada;
- validar fingerprint/certificado esperado quando aplicável;
- validar versão;
- preservar rollback/recovery.

Não utilizar apenas o fato de uma assinatura self-signed existir como
prova suficiente de confiabilidade.

A confiança temporária deverá estar vinculada ao certificado/fingerprint
esperado pelo PrintFlow.

Quando o certificado Production Trusted estiver disponível, migrar a
verificação para a identidade de produção correspondente.

==================================================
STATUS DA RELEASE
==================================================

Enquanto estiver usando certificado self-signed, distinguir
explicitamente a release como:

EARLY ACCESS / PILOT

e não como assinatura Production Trusted.

Exemplo conceitual:

signingMode = DEV_SELF_SIGNED

Depois:

signingMode = PRODUCTION_TRUSTED

==================================================
FRONTEND
==================================================

NUXT_PUBLIC_API_BASE é configuração pública.

Development:
localhost.

Production:
URL pública oficial.

O build Production deve falhar se NUXT_PUBLIC_API_BASE estiver
apontando para localhost.

==================================================
AGENT
==================================================

PRINTFLOW_API_URL deverá ser configurável.

Development:
localhost.

Production:
API pública oficial.

Todo push deverá provar que o Agent pode ser construído com a
configuração Production.

Uma release pública do Agent não deverá ser publicada em todo
commit.

Publicação oficial deverá ocorrer por versão/tag/release.

==================================================
BACKEND
==================================================

Secrets do Backend nunca deverão fazer parte do repositório ou
do pacote.

Exemplos:

DATABASE_URL
JWT secrets
OAuth secrets
Neon credentials
API secrets.

Produção recebe esses valores através do ambiente seguro do
servidor/provedor.

==================================================
ADMIN FRONTEND
==================================================

O AdminFrontEnd deverá ser validado/buildado quando necessário,
mas não deverá ser publicado junto ao painel público de clientes.

Manter deploy e acesso separados.

==================================================
DEPLOY
==================================================

Frontend e Backend podem possuir fluxo de deployment associado
à branch oficial de produção.

Fluxo da aplicação:

Push na branch de produção
↓
CI
↓
Secret Scan
↓
Tests
↓
Production Config Check
↓
Production Build
↓
Success
↓
Deploy FrontEnd/BackEnd
↓
Post-Deploy Smoke Test

Se qualquer etapa anterior falhar:

NÃO realizar deployment.

==================================================
RELEASE DO AGENT
==================================================

O Agent possui ciclo diferente do FrontEnd/BackEnd.

Em todo push:

CI
↓
Secret Scan
↓
Tests
↓
Production Config Check
↓
Build/package Production do Agent
↓
Validar artefato

Isso demonstra que o commit consegue produzir um Agent compatível
com produção.

NÃO publicar uma nova versão do Agent automaticamente em todo push.

Publicação oficial do Agent deverá ocorrer por versão/tag/release:

Tag/version
↓
Pipeline de release
↓
Tests
↓
Build
↓
Build installer
↓
Assinatura
↓
Timestamp
↓
Verificação da assinatura
↓
SHA-256
↓
Publicação do artefato
↓
Registro em Agent Releases

==================================================
POST-DEPLOY SMOKE TEST
==================================================

Após deployment:

validar ao menos:

- FrontEnd responde;
- Backend health responde;
- HTTPS válido;
- API Production correta;
- nenhuma configuração local está ativa.

Falha no smoke test deverá marcar deployment como falho e
acionar estratégia de rollback/recovery quando disponível.

==================================================
CRITÉRIO DE ACEITE
==================================================

Considerar esta tarefa concluída quando:

- desenvolvimento local permanece em localhost;
- nenhum arquivo precisa ser alterado manualmente para fazer push;
- cada push é validado como Production;
- build Production rejeita localhost;
- build Production rejeita mock DEV;
- secrets não são commitados;
- .gitignore foi auditado;
- arquivos rastreados foram auditados;
- secret scanner está ativo;
- testes rodam no CI;
- deploy só acontece após CI verde;
- Agent é validado como Production em cada push;
- release do Agent ocorre separadamente por versão;
- ambiente local continua Development após o push.

==================================================
CONFIGURAÇÃO DE AMBIENTE AGENT ↔ CLOUD
==================================================

Auditar como o Agent atualmente determina a URL do Backend.

Garantir que não exista endpoint de produção hardcoded espalhado
pelo código.

Criar uma única configuração central para o endpoint Cloud.

Suportar apenas dois ambientes nesta fase:

DEVELOPMENT

- API local;
- WebSocket local;
- uso em desenvolvimento/testes;
- localhost permitido.

PRODUCTION

- API oficial do PrintFlow;
- WebSocket oficial do PrintFlow;
- HTTPS/WSS obrigatório;
- configuração utilizada pelo Agent distribuído aos clientes.

Não implementar ambiente de staging nesta fase.

==================================================
URL DA API
==================================================

Utilizar uma configuração central equivalente a:

PRINTFLOW_API_URL

Exemplo em desenvolvimento:

http://localhost:3333

Endereço atual de produção:

https://printflow-api-4y5l.onrender.com

IMPORTANTE:

A URL de produção acima é o valor operacional atual, não deverá ser
hardcoded diretamente no código-fonte do Agent.

A fonte de verdade deverá ser configuração externa do build/CI.

Exemplo conceitual:

PRINTFLOW_API_URL=https://printflow-api-4y5l.onrender.com

O valor poderá ser fornecido através de GitHub Actions Variable,
configuração de build ou mecanismo equivalente.

Se futuramente a API utilizar domínio próprio, por exemplo:

https://api.printflow.com.br

a mudança não deverá exigir refatoração do código-fonte do Agent.

Se o WebSocket puder ser derivado da URL da API, preferir isso.

Exemplo:

http://  → ws://
https:// → wss://

Criar PRINTFLOW_WS_URL separado somente se houver necessidade real.
==================================================
BUILD DE DESENVOLVIMENTO
==================================================

Build de desenvolvimento deverá utilizar localhost por padrão.

Exemplo conceitual:

NODE_ENV=development

PRINTFLOW_API_URL=http://localhost:3000

Permitir sobrescrever endpoint durante desenvolvimento quando
necessário.

Essa possibilidade não deverá ser exposta de maneira simples ao
usuário final.

==================================================
BUILD DE PRODUÇÃO
==================================================

Build oficial do PrintFlow Agent deverá apontar por padrão para a
API oficial de produção.

O cliente final não deverá precisar informar manualmente a URL da
API durante instalação ou uso normal.

Não permitir que uma configuração comum da interface faça o usuário
trocar acidentalmente o Agent de produção para localhost.

==================================================
CREDENCIAIS POR AMBIENTE
==================================================

Credenciais de desenvolvimento e produção não devem ser misturadas.

Não reutilizar automaticamente:

agent_id
agent_secret
pairing
installation credentials

entre DEVELOPMENT e PRODUCTION.

Uma instalação pareada em desenvolvimento não deve ser considerada
automaticamente pareada em produção.

Uma instalação pareada em produção não deve enviar sua credencial
para localhost.

Credenciais deverão estar associadas ao endpoint/origin para o qual
foram emitidas.

==================================================
AGENT NÃO ACESSA O BANCO
==================================================

O Agent nunca deverá acessar diretamente o Neon PostgreSQL.

Proibido colocar no Agent:

DATABASE_URL
PostgreSQL password
Neon administrative credentials
database connection string

Fluxo obrigatório:

Agent
↓
PrintFlow Backend/API
↓
Neon PostgreSQL

==================================================
OBJECT STORAGE
==================================================

O Agent também não deverá possuir credencial administrativa
permanente do Cloudflare R2.

Fluxo:

Agent
↓
PrintFlow Backend

Backend valida:

- Agent;
- tenant;
- Job;
- File;
- autorização.

Depois o Backend fornece o mecanismo temporário seguro suportado
oficialmente pelo Cloudflare R2.

Quando tecnicamente suportado:

Cloudflare R2
↓
Agent

O arquivo poderá ser transferido diretamente sem atravessar todo o
Backend.

==================================================
SEGURANÇA DE TRANSPORTE
==================================================

DEVELOPMENT:

HTTP/WS local poderá ser permitido.

PRODUCTION:

usar somente:

HTTPS
WSS

Não permitir endpoint HTTP remoto inseguro em build de produção.

==================================================
WEBSOCKET + FALLBACK
==================================================

Durante a introdução do WebSocket:

WebSocket será o canal principal.

Polling HTTP atual continuará disponível como fallback.

Não remover polling até WebSocket estar validado em produção.

==================================================
CRITÉRIOS DE ACEITE
==================================================

Esta tarefa será considerada concluída quando:

- endpoint da API estiver centralizado;
- não houver URL de produção espalhada/hardcoded;
- Development usar localhost por padrão;
- Production usar API oficial por padrão;
- credenciais Development/Production não forem misturadas;
- Agent não possuir DATABASE_URL;
- Agent não acessar Neon PostgreSQL diretamente;
- produção exigir HTTPS/WSS;
- heartbeat continuar funcionando;
- polling continuar funcionando como fallback;
- WebSocket usar o mesmo modelo de autenticação/tenant do Agent;
- testes existentes continuarem passando.

==================================================
FORA DO ESCOPO ATUAL
==================================================

Não implementar nesta meta, salvo nova solicitação explícita:

- câmeras;
- streaming de vídeo;
- timelapse;
- computer vision;
- detecção visual de falhas;
- IA para análise de imagem;
- scheduling totalmente autônomo;
- seleção automática de impressora sem confirmação.

Esses itens podem permanecer documentados como possibilidades futuras,
mas não devem gerar código, migrations, dependências ou infraestrutura
nesta etapa.

## Classificação das 36 metas

| Meta | Estado | Evidência e lacuna decisiva |
|---|---|---|
| 1. Agent Hub | Existe parcialmente | Um Agent possui várias `agent_printers`; falta estado/fila local durável. |
| 2. Printer adapters | Existe parcialmente | Registry e cinco adapters existem; contrato/capabilities ainda não é formalmente versionado e hardware real não foi validado. |
| 3. Descoberta | Existe parcialmente | LAN e USB existem, mas LAN varre `/24` e portas em série; falta mDNS/netmask/configuração de limites. |
| 4. Tempo real | Existe parcialmente | Há heartbeat, mas comandos/status são polling HTTP; `cloud/websocket.js` está vazio/não integrado. |
| 5. Idempotência | Existe parcialmente | Há status de comando no backend, mas não ledger local de `command_id`; retry após queda pode repetir efeito físico. |
| 6. SQLite local | Não existe | Não há dependência, schema ou banco operacional local. |
| 7. Local Storage | Existe parcialmente | Credenciais, logs e cache existem; layout é inconsistente e não cobre queue/slicing/uploads pendentes. |
| 8. Cache local | Existe parcialmente | SHA-256, limite/idade/LRU e proteção por chaves ativas; falta pinagem explícita e metadados persistidos. |
| 9. Cloudflare R2 | Existe parcialmente | Provider R2 e fallback local existem; falta teste real e migração completa. |
| 10. File Manager | Existe parcialmente | `printFileCache` cobre download/cache; falta módulo de domínio que una metadata, jobs e limpeza. |
| 11. Resumable download | Não existe | Download HTTP não aceita Range, checkpoint nem arquivo parcial. |
| 12. Slicer local | Não existe | Sem adapter, processo, perfil, fila ou G-code gerado localmente. |
| 13. Perfis | Existe parcialmente | Receita/compatibilidade e `printerProfiles` existem; faltam perfis de slicer versionados e associação ao job. |
| 14. Orçamento automático | Existe parcialmente | Precificação/custos de produto existem; não há análise de modelo/slicing alimentando orçamento real. |
| 15. Production Job | Existe parcialmente | `print_jobs` e transições básicas existem; falta modelo de execução local, tentativas e eventos de ciclo completo. |
| 16. Fila local | Não existe | Só há `agent_commands`/`print_jobs` no servidor e memória no Agent. |
| 17. Sync Manager | Não existe | Não há outbox, cursor, retry persistido, conflito ou reconciliação. |
| 18. Telemetria | Existe parcialmente | Status pontual (temperatura/progresso quando adapter suporta) é salvo; sem agregação, cadência, retenção ou eventos. |
| 19. Sem telemetria bruta no Neon | Não é necessário agora | Não há pipeline de telemetria; preservar esta regra ao criá-lo. |
| 20. Estoque automático | Existe parcialmente | Conclusão confirmada baixa filamento uma vez; não há consumo real vindo do Agent. |
| 21. Antiduplicidade de estoque | Existe parcialmente | Teste cobre baixa única por conclusão; falta chave idempotente vinculada a evento local. |
| 22. Custo estimado vs. real | Existe parcialmente | `costBreakdown` e precificação existem; sem tempo/energia/material real de job. |
| 23. Manutenção | Existe parcialmente | Cadastro de impressora possui data/status; falta plano, eventos, bloqueio e telemetria de manutenção. |
| 24. Câmeras | Fora do escopo atual | Não implementar nesta meta. Manter apenas a arquitetura sem impedir uma integração futura. |
| 25. Imagens/thumbnails | Existe parcialmente | Metadata 3MF/G-code existe; thumbnails poderão ser gerados futuramente como parte do processamento de arquivos, sem depender de câmera. |
| 26. Detecção de falhas por visão | Fora do escopo atual | Não implementar câmera, visão computacional ou detecção visual nesta fase. |
| 27. Distribuição inteligente | Não é necessário agora | Manter seleção explícita. Recomendação poderá ser tratada somente após capabilities, telemetria e Production Jobs estarem maduros. |
| 28. Update do Agent | Não existe | Sem manifesto, assinatura, atualização, health-check ou rollback. |
| 29. Segurança do Agent | Existe parcialmente | Segredo individual, hash/revogação e tenancy existem; falta proteção local do segredo, rotação/expiração e escopo/atestado. |
| 30. Multi-tenancy | Existe parcialmente | Backend deriva tenant e usa RLS; revisar todas as novas tabelas e comandos sob RLS/`withTenant`. |
| 31. Observabilidade | Existe parcialmente | Logs e auditoria/watchdogs existem; não há log estruturado correlacionável (`command_id`, `job_id`) ou métricas. |
| 32. Resiliência | Existe parcialmente | Backoff de polling, watchdog e cache existem; faltam outbox SQLite, reconnect WebSocket, retry com jitter e circuit breaker. |
| 33. Performance | Existe parcialmente | Cache e validações existem; backend ainda transmite todo arquivo e há polling desnecessário. |
| 34. Local-first pesado | Existe parcialmente | Cache e comunicação com impressora são locais; slicing/análise pesada ainda acontece no backend ou não existe. |
| 35. Análise STL | Não existe | Há análise básica de 3MF/G-code no backend, não STL local no Agent. |
| 36. Produção completa | Existe parcialmente | Fila → comando → impressão e baixa confirmada existem; faltam storage, sync, slicing, eventos, consumo/custo reais e entrega integrada. |
==================================================
META 37 — VERSIONAMENTO, INSTALLER E RELEASE DO AGENT
==================================================

Esta meta faz parte do escopo atual.

Ela NÃO significa implementar auto-update imediatamente.

A ordem obrigatória é:

1. Semantic Versioning.
2. Fonte única de versão.
3. Versão no heartbeat.
4. Versão persistida no Cloud.
5. Auditoria dos scripts Windows existentes.
6. Installer profissional.
7. Upgrade in-place.
8. Assinatura Authenticode de produção.
9. Timestamp.
10. SHA-256 do artefato final.
11. Agent Releases.
12. Pipeline CI/CD.
13. Auto-update seguro somente após todos os anteriores.

A ausência temporária de certificado Code Signing de produção não
deve bloquear as etapas independentes:

- Semantic Versioning;
- heartbeat/version reporting;
- Agent Releases;
- installer;
- upgrade in-place;
- pipeline de build;
- SHA-256;
- testes de atualização.

Enquanto certificado de produção não estiver provisionado,
utilizar exclusivamente o fluxo dev existente para testes internos.

Releases destinadas aos primeiros clientes poderão ser distribuídas
em modo Early Access/Pilot utilizando assinatura self-signed.

Enquanto o certificado confiável de produção não estiver disponível,
a release deverá registrar explicitamente:

signingMode = DEV_SELF_SIGNED

Quando o certificado Code Signing confiável estiver disponível,
alterar para:

signingMode = PRODUCTION_TRUSTED

A ausência do certificado confiável não bloqueia a utilização
comercial inicial do Agent, mas a interface/documentação não deve
representar o certificado self-signed como publicamente confiável.

==================================================
META 37.1 — SEMANTIC VERSIONING
==================================================

Adotar Semantic Versioning:

MAJOR.MINOR.PATCH

Exemplos:

1.0.0
1.0.1
1.1.0
2.0.0

Definir UMA única fonte de verdade da versão.

Não manter versões diferentes manualmente em vários arquivos.

A versão deverá alimentar automaticamente:

- Agent;
- pacote;
- instalador;
- heartbeat;
- Backend;
- releases;
- logs;
- About/diagnóstico;
- nome/metadata do executável quando apropriado.

Evitar hardcode duplicado.

==================================================
META 37.2 — VERSÃO NO HEARTBEAT
==================================================

O Agent deverá informar no heartbeat/conexão:

agentVersion
platform
architecture

Exemplo:

{
  "agentVersion": "1.4.0",
  "platform": "win32",
  "architecture": "x64"
}

Backend deverá persistir a versão atual do Agent.

Painel deverá futuramente conseguir apresentar:

Agent Produção

Online
Versão instalada: 1.4.0
Última versão: 1.5.0

==================================================
META 37.3 — RELEASES
==================================================

Criar conceito de Agent Release.

Estrutura conceitual:

agent_releases

id
version
channel
platform
architecture
storage_key
sha256
release_notes
mandatory
minimum_supported_version
published_at
created_at

Não copiar schema cegamente.

Adequar ao banco existente.

Considerar canais futuros:

stable
beta

Inicialmente stable é suficiente.

==================================================
META 37.4 — INSTALADOR WINDOWS PROFISSIONAL
==================================================

Migrar progressivamente a experiência do usuário de:

PowerShell diretamente

para:

PrintFlowAgentSetup.exe

Preferência inicial:

Inno Setup

ou solução equivalente caso a análise técnica demonstre alternativa
mais apropriada.

Não migrar para CMD.

Objetivo:

Usuário baixa:

PrintFlowAgentSetup.exe

e realiza instalação através de interface normal do Windows.

O instalador deverá futuramente cuidar de:

- arquivos;
- diretórios;
- ícone;
- atalhos;
- startup/serviço;
- versão;
- upgrade;
- desinstalador;
- preservação de configuração.

==================================================
META 37.5 — MIGRAÇÃO SEM QUEBRAR INSTALAÇÕES
==================================================

A instalação PowerShell atual deverá continuar funcionando durante
o período de transição.

Primeira versão do novo instalador poderá reutilizar internamente
as rotinas PowerShell atuais.

Exemplo:

PrintFlowAgentSetup.exe
        ↓
rotinas existentes
        ↓
Agent

Depois migrar responsabilidades gradualmente.

Não remover scripts antigos antes de validar:

- instalação nova;
- upgrade;
- repair;
- uninstall;
- rollback.

==================================================
META 37.6 — UPGRADE IN-PLACE
==================================================

Instalar uma versão nova sobre versão antiga NÃO poderá apagar:

- agent_id;
- pareamento;
- segredo/credencial;
- configurações;
- SQLite;
- fila pendente;
- cache necessário;
- configurações de impressoras;
- dados operacionais necessários.

Separar claramente:

BINÁRIOS

de:

DADOS DO AGENT.

Exemplo conceitual:

Program Files/
    PrintFlow Agent/
        binários

ProgramData/AppData/
    PrintFlow/
        configuração
        SQLite
        credenciais
        cache
        logs

Adequar aos diretórios oficiais do Windows.

==================================================
META 37.7 — ASSINATURA DE DESENVOLVIMENTO VS PRODUÇÃO
==================================================

A implementação atual possui:

sign-windows-agent-dev.ps1

e:

trust-windows-agent-dev-certificate.ps1

Tratar explicitamente isso como fluxo de DESENVOLVIMENTO.

Certificado self-signed/dev deve ser utilizado somente para:

- desenvolvimento;
- máquinas internas;
- testes;
- CI específico de desenvolvimento quando necessário.

Usuário final NÃO deverá precisar executar:

trust-windows-agent-dev-certificate.ps1

para instalar o produto em produção.

Produção deverá utilizar assinatura Authenticode com identidade de
Code Signing apropriada e confiável.

==================================================
META 37.8 — NÃO EXPOR CHAVE PRIVADA
==================================================

Auditar a pasta:

certs/

e todo o mecanismo atual de assinatura.

Verificar se existe:

.pfx
.p12
.pem
.key

ou qualquer arquivo contendo chave privada.

Chave privada de assinatura NÃO deverá ser commitada no repositório.

Senha da chave também não poderá existir hardcoded nos scripts.

Para produção utilizar armazenamento seguro apropriado:

- secret store do CI;
- certificate store;
- serviço de assinatura;
- hardware/token quando aplicável.

Nunca imprimir segredo em logs.

==================================================
META 37.9 — AUTHENTICODE
==================================================

Release de produção deverá ter assinatura Authenticode válida.

Assinar todos os executáveis relevantes.

Por exemplo:

PrintFlowAgent.exe

PrintFlowAgentService.exe
quando existir

PrintFlowUpdater.exe
quando existir

PrintFlowAgentSetup.exe

Aplicar timestamp apropriado.

Após assinatura verificar a assinatura.

O pipeline deverá falhar se verificação falhar.

==================================================
META 37.10 — HASH DA RELEASE
==================================================

Após gerar e assinar o artefato final:

calcular SHA-256.

O SHA-256 armazenado no Backend deverá corresponder exatamente ao
artefato publicado.

Nunca calcular hash antes de modificar/assinar o arquivo.

Fluxo:

Build
↓
Sign
↓
Timestamp
↓
Verify
↓
SHA-256
↓
Publish

==================================================
META 37.11 — CLOUDFLARE R2 PARA RELEASES
==================================================

Para releases do Agent, quando esse uso for ativado e validado, armazenar os
artefatos no Cloudflare R2 de forma equivalente a:

agent-releases/
    windows/
        x64/
            1.4.0/
                PrintFlowAgentSetup.exe

No PostgreSQL guardar metadata da release.

Não armazenar o executável diretamente no PostgreSQL.

Enquanto a distribuição de releases via R2 não estiver pronta, preservar o
mecanismo de distribuição atual. Isso é separado do storage de arquivos de
impressão, que já usa o provider R2 quando configurado.

Não bloquear a evolução do Agent por causa disso.

==================================================
META 37.12 — CI/CD DE RELEASE
==================================================

Preparar pipeline futuro:

Git tag

v1.4.0
   ↓
tests
   ↓
lint
   ↓
typecheck
   ↓
build Agent
   ↓
build package
   ↓
build installer
   ↓
sign executables
   ↓
sign installer
   ↓
timestamp
   ↓
verify signatures
   ↓
SHA-256
   ↓
publish artifact
   ↓
register Agent Release

Nenhuma release deve ser marcada como disponível se uma etapa
crítica falhar.

==================================================
META 37.13 — AUTO UPDATE
==================================================

AUTO UPDATE é uma etapa posterior ao sistema de releases.

Não implementar atualização automática antes de:

- Semantic Versioning;
- releases;
- assinatura;
- SHA-256;
- upgrade in-place;
- rollback;
- preservação de dados;
- verificação de integridade.

Agent deverá futuramente conseguir consultar:

currentVersion
latestVersion
minimumSupportedVersion
mandatory

Exemplo:

Current:
1.3.0

Latest:
1.4.0

Minimum supported:
1.2.0

==================================================
META 37.14 — UPDATE SEGURO
==================================================

Antes de instalar uma atualização:

1. baixar;
2. verificar tamanho/metadata;
3. verificar SHA-256;
4. verificar Authenticode;
5. verificar publisher esperado;
6. fechar/parar Agent de forma controlada;
7. instalar;
8. iniciar novamente;
9. executar health check;
10. confirmar atualização.

Se falhar:

usar rollback/recuperação quando tecnicamente possível.

Nunca executar automaticamente um arquivo apenas porque o Backend
forneceu uma URL.

==================================================
META 37.15 — UPDATE OPCIONAL E OBRIGATÓRIO
==================================================

Suportar futuramente:

mandatory = false

para atualização normal.

mandatory = true

somente quando necessário, como:

- vulnerabilidade crítica;
- incompatibilidade de protocolo;
- versão sem suporte;
- falha séria.

Utilizar também:

minimum_supported_version

para impedir manutenção infinita de protocolos muito antigos.

==================================================
META 37.16 — COMPATIBILIDADE DO PROTOCOLO
==================================================

Versão do Agent e versão do protocolo Agent ↔ Cloud não devem
obrigatoriamente ser a mesma coisa.

Preparar conceito de protocolVersion se futuramente necessário.

Exemplo:

Agent:
1.8.3

Protocol:
2

Isso permitirá atualizar funcionalidades sem quebrar imediatamente
Agents antigos.

==================================================
META 37.17 — WINDOWS SERVICE
==================================================

Avaliar migração futura da execução principal para Windows Service.

Objetivo:

Windows
   ↓
PrintFlow Agent Service
   ↓
Agent

O usuário não deverá precisar executar:

start-windows-agent.ps1

manualmente no uso normal.

Service deverá considerar:

- startup automático;
- recovery após crash;
- stop/start controlado;
- logs;
- atualização;
- permissões mínimas;
- interação correta com sessão do usuário.

IMPORTANTE:

Se o Agent atual possuir tray/UI, separar responsabilidades.

Exemplo:

PrintFlowAgentService.exe
        ↓
core Agent

PrintFlowAgentTray.exe
        ↓
interface do usuário

Não colocar UI dentro de Service de maneira inadequada.

==================================================
META 37.18 — PRESERVAR TRAY ATUAL
==================================================

Como existe atualmente:

start-windows-agent-tray.ps1

analisar se há interface tray existente.

Não remover funcionalidade durante migração.

Se necessário, arquitetura futura:

Windows Service
       │
       └── Agent Core

Tray App
       │
       └── status/configuração

Comunicação local segura entre eles.

Somente implementar esta separação se realmente necessária.

==================================================
CRITÉRIOS DE ACEITE — RELEASE WINDOWS
==================================================

Considerar esta meta concluída somente quando:

- existe uma única fonte de versão;
- build reproduzível;
- instalador profissional;
- instalação sem PowerShell visível ao usuário;
- upgrade preserva pareamento;
- uninstall funciona;
- versão aparece no Cloud;
- artefato possui SHA-256;
- release de produção possui assinatura válida;
- timestamp está presente;
- chave privada não está no repositório;
- scripts dev continuam disponíveis para desenvolvimento;
- instalação legada possui estratégia de migração;
- rollback/recovery está documentado;
- pipeline de release está documentado/testado.

## Problemas e riscos priorizados

Antes de iniciar a Fase P0, acrescente uma regra arquitetural
obrigatória à META:

==================================================
AGENT COMO INTEGRAÇÃO OPCIONAL
==================================================

O PrintFlow Cloud continua sendo o sistema principal.

O PrintFlow Agent é uma camada opcional de integração e execução
local.

A existência ou disponibilidade do Agent NÃO pode ser requisito
para utilizar as funcionalidades administrativas essenciais
do PrintFlow.

SEM AGENT devem continuar funcionando normalmente:

- autenticação
- usuários
- empresas
- clientes
- produtos
- pedidos
- orçamentos
- estoque
- financeiro
- arquivos
- histórico
- relatórios
- gestão de produção manual
- configurações administrativas

COM AGENT são adicionados nesta meta:

- integração com impressoras
- descoberta de impressoras
- status em tempo real
- temperaturas
- progresso
- start/pause/resume/cancel
- telemetria
- slicing local
- cache local
- fila offline
- automação de produção
- sincronização com hardware
- consumo automatizado
- manutenção baseada em utilização

Recursos como câmeras, streaming, timelapse e visão computacional
não fazem parte do escopo atual.

O Agent NÃO é a fonte principal dos dados de negócio.

Fonte oficial:

Neon PostgreSQL
+
Cloudflare R2

SQLite e filesystem do Agent são camadas operacionais locais.

Se Agent estiver offline, dados administrativos e operações
que não dependem diretamente do hardware local devem continuar
funcionando.

Nenhuma refatoração futura deverá mover regra essencial de
negócio para dentro do Agent de maneira que torne o SaaS
dependente dele.

Production Jobs devem possuir representação oficial na Cloud,
mesmo quando também forem persistidos localmente para execução
offline.

Configurações oficiais das impressoras devem continuar
persistidas na Cloud. O Agent fornece estado operacional
e integração física.

O modo manual deve continuar disponível como fallback sempre
que for tecnicamente possível.

1. **P0 — efeito físico duplicado:** comandos ficam `running`, podem ser expirados e não há ledger local de conclusão. `start_print`, cancelamento, estoque e sync precisam de IDs idempotentes persistidos antes de retry automático.
2. **P0 — segredo local:** `agent.json` contém segredo reutilizável em JSON. Implementar armazenamento protegido pelo SO/conta, permissões de arquivo e rotação progressiva, sem quebrar instalações existentes.
3. **P0 — comando sem atomicidade de claim:** a busca seleciona e atualiza em operações separadas. Um futuro canal concorrente/reconnect deve usar claim atômico e versão/lease.
4. **P1 — arquivos grandes no Backend:** upload e download atravessam a API e o filesystem efêmero do deploy. Isso limita tamanho, escala horizontal e resiliência.
5. **P1 — polling e writes:** Agent consulta a cada 5 s; painel consulta resultado a cada 1 s e status em ciclo de 30 s. Isso aumenta requests/writes e piora latência percebida.
6. **P1 — descoberta LAN agressiva:** varredura fixa de 254 hosts, quatro portas e chamadas HTTP; deve ser limitada, cancelável e baseada em netmask/mDNS quando possível.
7. **P1 — estado local só em memória:** reinício perde conexões, operações, downloads e progresso. Não há operação offline segura.
8. **P2 — contrato de capabilities:** o frontend infere formatos/ações de listas locais, em vez de usar capability da impressora retornada pelo Agent/Backend como fonte explícita.

## Mudança de dados necessária, mas não iniciada

Não criar migration nesta fase. A menor evolução segura deve usar migrations aditivas e rollout em duas versões:

- `agents`: `installation_id`, `capabilities`, `credential_version`, `last_connected_at`, `last_disconnect_reason`; manter `secret_hash` até rotação concluída.
- `agent_commands`: UUID público `command_id`, `idempotency_key`, `attempt`, `lease_expires_at`, `accepted_at`; índices únicos por Agent/chave de idempotência e de busca por estado. Não reutilizar o `bigserial` atual como protocolo futuro.
- `agent_printers`: `capabilities`, `last_telemetry_at`, `adapter_version`; manter dados de credencial fora desta tabela.
- Novas tabelas cloud somente quando a fase exigir: `files` (metadata e linhagem), `file_links`, `agent_events` agregados e `production_job_attempts`. Todas devem conter `tenant_id`, RLS e índices alinhados às consultas reais.
- SQLite local, não Neon: `processed_commands`, `local_jobs`, `sync_outbox`, `downloads`, `cache_entries`, `printer_state`, `settings` e schema versionado. Ele é operacional, nunca réplica completa da cloud.

## Estratégia técnica incremental

### P0 — fundação e segurança

1. Definir contrato versionado `PrinterAdapter` e capabilities; ajustar testes para todos os adapters.
2. Adicionar SQLite com migrations locais, diretório por sistema operacional, `processed_commands` e outbox. Introduzir somente os comandos já existentes.
3. Tornar claim/complete idempotentes no backend; gravar resultado e emitir eventos de forma transacional. Tratar repetição de `start_print` como retorno do resultado anterior, não nova impressão.
4. Proteger/rotacionar credencial do Agent e criar logs JSON com redaction e IDs de correlação.
5. Manter heartbeat; acrescentar WebSocket autenticado com reconexão/backoff como caminho preferido e polling como fallback até prova de compatibilidade com deploy.

### Critérios obrigatórios para considerar o P0 concluído

O P0 somente poderá ser considerado concluído quando:

- SQLite local possuir migrations/versionamento de schema;
- processed_commands sobreviver a reinício do Agent;
- reentrega de start_print não iniciar uma segunda impressão;
- claim de comando for atômico;
- complete repetido for idempotente;
- credencial do Agent estiver protegida/migrada;
- instalação existente continuar pareando normalmente;
- heartbeat continuar funcionando;
- WebSocket reconectar com backoff;
- polling continuar disponível como fallback;
- falha/restart do Agent possuir testes;
- testes do Agent estiverem verdes;
- testes do Backend estiverem verdes;
- não houver regressão de multi-tenancy.

Somente após todos esses critérios o P1 dependente dessa
fundação poderá ser considerado liberado.

### P1 — produção controlada

1. Persistir estado de impressora/job local e sincronizar eventos agregados; não enviar temperatura por segundo indiscriminadamente.
2. Expor capabilities no backend e consumir no frontend para esconder controles não suportados.
3. Melhorar descoberta (netmask real, limites de concorrência/tempo, opção manual e mDNS onde houver suporte) e validar com hardware real.
4. Introduzir `FileManager`, download com resume e cache pinado por job.

### P1 — Object Storage, somente após P0 estável

Criar a interface interna `ObjectStorageProvider` no Backend, com operações que o domínio realmente usa (`put/get/head/delete` e criação de autorização temporária se oficialmente suportada). Implementar o provider S3 compatível do Cloudflare R2; não colocar SDK, credencial de bucket ou `DATABASE_URL` no Agent. Trocar em rollout: leitura compatível com storage local existente → escrita nova no provider → cópia/verificação de hash → mudança de leitura → limpeza auditada. Browser e Agent devem receber somente autorização curta emitida após autenticação e escopo tenant/arquivo/job no Backend. Validar o endpoint R2 e o bucket no ambiente de execução.

### P1 — versionamento e installer

Implementar nesta ordem:

1. Semantic Versioning;
2. fonte única de versão;
3. versão no heartbeat;
4. versão persistida no Cloud;
5. auditoria dos scripts Windows existentes;
6. installer profissional;
7. upgrade in-place;
8. assinatura Authenticode de produção;
9. timestamp;
10. preservação do pareamento e dados locais.

O PowerShell atual permanece como ferramenta interna e fallback
durante a migração.

Não migrar PowerShell para CMD.


### P2 — pipeline de release

### P2 — pipeline de release

Após a fundação de versionamento/installer estar validada:

1. Agent Releases;

2. SHA-256 do artefato final;

3. pipeline CI/CD;

4. publicação do instalador;

5. minimum supported version;

6. release notes.

Nenhuma release deverá ser marcada como disponível se uma etapa
crítica do pipeline falhar.

### P2 — processamento e automação de produção

Somente após P0 e P1 estarem concluídos e validados:

1. integrar um único slicer;
2. criar perfis versionados;
3. análise local de STL/3MF;
4. integrar resultado de slicing aos Production Jobs;
5. integrar consumo estimado e real;
6. integrar estoque;
7. calcular custo estimado versus real;
8. implementar manutenção baseada em utilização.

Não adicionar múltiplos slicers antes de estabilizar o primeiro.


### P2 — Auto-update seguro

Auto-update somente poderá ser iniciado após:

- Agent Releases estarem funcionando;
- pipeline de release estar validado;
- installer suportar upgrade in-place;
- assinatura Authenticode estar validada;
- timestamp estar validado;
- SHA-256 estar validado;
- publisher esperado ser verificável;
- rollback/recovery estar definido;
- SQLite estar separado dos binários;
- credenciais/configurações estarem separadas dos binários;
- pareamento sobreviver a upgrade.

Fluxo mínimo:

detectar nova versão
↓
baixar
↓
validar SHA-256
↓
validar Authenticode
↓
validar publisher
↓
parar Agent de forma controlada
↓
instalar
↓
iniciar Agent
↓
health check
↓
confirmar upgrade

Se a validação do artefato falhar:

NÃO executar o instalador.

### P3 — futuro

Não implementar agora:

- câmera;
- timelapse;
- visão computacional;
- detecção visual de falhas;
- scheduling autônomo;
- automações críticas sem confirmação.
## Backlog proposto

| Prioridade | Item | Dependências | Risco | Critério de aceite |
|---|---|---|---|---|

| P0 | Gate de repositório/CI | Estrutura Git existente | Alto | Push é analisado por secret scan, arquivos proibidos e Production Config Validator; deploy não ocorre com CI vermelho. |
| P0 | Configuração Development/Production | Gate de CI | Alto | Local permanece localhost; CI consegue gerar/validar build Production sem alterar arquivos locais. |
| P0 | Ledger SQLite + idempotência | Diretório local, schema local | Alto | Reinício/reentrega de `start_print` não inicia duas vezes; testes de queda/retry passam. |
| P0 | Claim atômico e lease de comando | Migration aditiva | Alto | Um comando só é entregue a uma execução; `complete` repetido retorna resultado consistente. |
| P0 | Proteção/rotação de credencial do Agent | Estratégia Windows e compatibilidade | Alto | Segredo não fica legível de forma insegura; instalação legada migra/rota sem perder pareamento. |
| P0 | Canal push com fallback | Autenticação Agent, infraestrutura de deploy | Médio | WebSocket reconecta com backoff; heartbeat continua ativo; polling permanece funcional como contingência. |
| P1 | Capabilities ponta a ponta | Contrato `PrinterAdapter` | Médio | UI mostra apenas ações suportadas pela impressora e Backend continua validando as operações. |
| P1 | Sync/outbox e eventos agregados | SQLite, idempotência | Alto | Operação offline fica persistida e é sincronizada uma única vez após reconexão. |
| P1 | Versionamento centralizado do Agent | Estrutura atual de build/package | Baixo | Existe uma única fonte de versão; heartbeat e Cloud apresentam corretamente a versão instalada. |
| P1 | Auditoria do instalador Windows atual | Scripts PowerShell existentes | Baixo | Fluxos de build, install, startup, tray, signing, trust e uninstall estão documentados e classificados como dev/produção. |
| P1 | Installer Windows profissional | Auditoria do instalador, versionamento | Médio | `PrintFlowAgentSetup.exe` instala sem exigir PowerShell visível ao usuário e preserva pareamento/configuração em upgrade. |
| P1 | Assinatura de produção | Installer, certificado Code Signing | Alto | Executáveis e Setup possuem Authenticode válido, timestamp e verificação automatizada da assinatura. |
| P1 | FileManager + Range/cache pinado | SQLite, sync/outbox | Médio | Download interrompido pode continuar quando suportado; hash confere; arquivo usado por job ativo não é removido. |
| P1 | Cloudflare R2 Provider + migração de arquivos | FileManager, configuração R2, URLs temporárias | Alto | Metadata mantém tenant/hash; Browser/Agent não recebem credencial administrativa; leitura antiga possui fallback durante rollout. |
| P2 | Pipeline de release | Versionamento, installer, assinatura | Médio | Tag/release gera artefato testado, assinado, timestampado, verificado e com SHA-256 reproduzível. |
| P2 | Slicer único + perfis | FileManager, fila local, cache | Alto | Job reproduzível gera G-code validado localmente sem bloquear o processo principal do Agent. |
| P2 | Production Job completo | Sync, fila local, slicer, capabilities | Alto | Job possui ciclo completo Cloud ↔ Agent ↔ Printer, estados consistentes e recuperação após queda. |
| P2 | Telemetria agregada | Sync/eventos, Production Job | Médio | Telemetria frequente fica local; Cloud recebe snapshots/eventos agregados sem writes excessivos no Neon. |
| P2 | Estoque e consumo real | Production Job, eventos idempotentes | Alto | Conclusão/falha atualiza consumo sem duplicidade e diferencia estimado de real quando disponível. |
| P2 | Custo estimado vs. real | Slicer, Production Job, consumo | Médio | PrintFlow consegue comparar tempo/material/custo estimado com resultado real do job. |
| P2 | Manutenção baseada em utilização | Telemetria, histórico de jobs | Médio | Sistema registra horas/jobs/falhas e consegue alertar manutenção conforme regras configuradas. |
| P2 | Auto-update seguro | Pipeline de release, upgrade in-place, assinatura, SHA-256 | Alto | Agent valida hash e Authenticode antes da atualização, preserva dados e possui estratégia de recovery/rollback. |
| Fora do escopo atual | Câmeras, streaming, timelapse e visão computacional | — | — | Não gerar código, migration, dependência ou infraestrutura para esses recursos nesta meta. |
| Fora do escopo atual | Detecção visual de falhas por IA | Câmeras/visão futuramente | — | Apenas manter como possibilidade futura; não implementar agora. |

## Dependências e critérios globais de conclusão

Gate de repositório/CI/secret scanning

→ configuração Development/Production

→ PrinterAdapter/capabilities

→ SQLite local

→ idempotência

→ claim atômico

→ proteção/rotação de credenciais

→ sync/outbox/fila local

→ WebSocket + polling fallback

→ versionamento centralizado

→ auditoria/migração do installer

→ installer profissional

→ assinatura de produção

→ FileManager/cache

→ Cloudflare R2

→ pipeline de release

→ slicer local

→ Production Job completo

→ telemetria agregada

→ estoque/consumo real

→ custo estimado vs. real

→ manutenção

→ auto-update seguro

Câmeras, streaming, timelapse, visão computacional e detecção
visual de falhas NÃO fazem parte da ordem atual de implementação.


Uma fase só é concluída quando possui: migration/rollback quando houver banco; RLS e teste cross-tenant; teste unitário e integração aplicável; teste de reinício/retry para efeitos físicos; prova com hardware para adapter; revisão de logs sem segredos; medição de polling/writes; compatibilidade de leitura durante rollout; e documentação operacional/reversão. Build verde isolado não comprova impressão, storage ou tenancy em produção.

## Verificações desta auditoria

- `npm.cmd --prefix Agent test`: 21/21 aprovados, incluindo mock Bambu, cache/hash, adapters HTTP e Marlin serial simulado.
- `npm.cmd --prefix BackEnd test`: 111/111 aprovados, incluindo validação de impressão, metadata/limpeza de arquivo, estoque confirmado e segurança/autorização.
- Inspeção estática de rotas, migrations, pool tenant/RLS, watchdogs, Agent, adapters, storage e painel de impressoras.

Esses resultados não são evidência de conexão a uma impressora real, PostgreSQL/Neon real, Cloudflare R2 em produção, WebSocket em deploy, nem de upload grande/recuperação após falha de rede.

## Registro de execução posterior à auditoria

### 2026-09-19 — P0.0: gate de repositório e configuração Production

Concluído de forma aditiva, sem migration, alteração de dados, alteração de pareamento ou mudança do instalador publicado:

- auditados os arquivos rastreados; não há `.env`, PFX/P12/PEM/KEY, keystore, SQLite, logs, `agent.json` ou `printer-credentials.json` rastreados;
- preservados os artefatos legítimos já rastreados: certificado público, instalador e ZIP em `FrontEnd/public/downloads`, além dos ícones do Agent;
- auditado o histórico por indicadores de alta confiança (`AKIA`, `sk_live_`, `PRIVATE_KEY`, `xoxb-`), sem ocorrência;
- `.gitignore` recebeu apenas regras específicas para runtime local do Agent e backups locais; não foram adicionadas regras globais para `.exe`, `.zip` ou `.cer`;
- criado `scripts/check-production-config.mjs`, que exige HTTPS para API/painel, WSS quando configurado, proíbe hosts locais e mock Bambu em Production;
- CI passou a usar checkout com histórico completo, Gitleaks e o validador Production antes da matriz de testes/builds.

Validações executadas:

- o validador aceitou configuração HTTPS/WSS de Production;
- o validador rejeitou HTTP, WS, localhost e mock DEV;
- `node --check scripts/check-production-config.mjs` passou;
- `git check-ignore` confirmou runtime/backup ignorados e artefatos publicados preservados.

Riscos e pendências:

- Gitleaks foi configurado no CI, mas a CLI não está instalada neste computador para uma varredura local completa;
- `docs/PRINTFLOW_AGENT_FASE_0_AUDITORIA.md` continua ignorado pela regra pré-existente, portanto esta atualização local não entrará no índice até a decisão explícita de versionar o relatório;
- o próximo item da ordem P0 continua sendo validar a implementação existente de capabilities/SQLite/idempotência contra os critérios formais e preencher lacunas sem reescrever conexões ou instalador que já funcionam.

### 2026-09-19 — P0.1: capabilities ponta a ponta

Concluído sem migration e sem alterar adapters, conexões existentes ou contratos de pareamento:

- capabilities armazenadas no metadata de `agent_printers` são expostas ao painel por `appData`;
- a tela preserva o comportamento de vínculos legados sem capabilities e impede comandos não oferecidos;
- o Backend passou a validar `status`, `startPrint`, `pause`, `resume`, `cancel` e `disconnect` antes de criar um comando;
- a ausência de capabilities em vínculo legado continua permissiva para rollout compatível; quando o bloco existe, somente `true` autoriza a operação.

Validações executadas:

- teste unitário do Backend para compatibilidade legada e rejeição Cloud de ação ausente;
- `node --check BackEnd/src/routes/agents.js`;
- `git diff --check`.

Segurança/multi-tenancy/performance:

- a verificação usa somente metadata da impressora já carregada dentro de `tenantQuery` com `user.tenantId` autenticado;
- não adiciona write, polling ou query adicional; evita comandos inválidos e seus writes subsequentes;
- não há mudança de RLS, schema ou acesso do Agent ao banco.

### 2026-09-19 — P0.2: schema SQLite versionado

Concluído:

- `agent-operations.sqlite` passou a manter `PRAGMA user_version = 1`;
- a migração v1 cria apenas as tabelas e índice operacionais já adotados (`processed_commands`, `command_completions`), de forma transacional e idempotente;
- banco local sem versão, inclusive com comandos já concluídos, é migrado preservando dados;
- o Agent rejeita banco criado por versão futura em vez de tentar escrever em schema desconhecido.

Validações executadas:

- teste de migração de banco legado preservando resultado idempotente;
- testes de idempotência, outbox e recuperação após reinício;
- `node --check Agent/src/storage/localOperationsDb.js`;
- `git diff --check`.

Impacto:

- nenhuma migration PostgreSQL, RLS ou write no Neon;
- uma única leitura/escrita de `user_version` na abertura local;
- rollback operacional: o schema anterior permanece estruturalmente compatível, e a única marca nova é a versão local.

### 2026-09-19 — P0.3: logs estruturados e redação

Concluído:

- o arquivo de log local do Agent passou a ser JSON Lines com `timestamp`, `level` e `message`;
- a rotação de 5 MB e a saída original no console foram preservadas;
- valores de campos sensíveis (`secret`, `token`, senha, Access Code, API key, authorization e credenciais) são redigidos antes de persistir;
- tokens em URLs temporárias e cabeçalhos Bearer também são redigidos.

Validações executadas:

- teste de redação de objeto aninhado e URL temporária;
- teste de gravação JSON Lines sem segredo no arquivo local;
- `node --check Agent/src/logging/fileLogger.js`;
- `git diff --check`.

Risco residual:

- a redação cobre nomes e padrões conhecidos; novos formatos de segredo devem continuar sendo tratados como dados proibidos nos chamadores, e o secret scanning do CI é a camada complementar.

### 2026-09-19 — P1 antecipado permitido: versão centralizada

Concluído sem alterar pacote, instalador, pareamento ou versão publicada:

- `AGENT_VERSION` passou a ter uma fonte única em `src/config/agentVersion.js`;
- o canal SSE autenticado existente foi mantido como equivalente compatível ao push previsto; ele valida `x-agent-id`/`x-agent-secret`, envia somente `command_available` e mantém heartbeat/polling como fallback;
- reconexão do Agent mantém backoff com jitter de 1 a 30 segundos;
- corrigida a verificação do resultado do claim: a rota agora verifica o `UPDATE agent_commands ... status = 'pending'` que efetivamente reivindicou o comando, não a consulta anterior de expiração;
- a correção evita perder comandos válidos quando não havia comandos `running` expirados.
- heartbeat, pareamento e servidor local continuam consumindo a exportação compatível de `agentInfo`;
- a configuração legada passou a referenciar a mesma constante, eliminando duplicidade de versão.

### Auditoria do instalador existente

- os scripts PowerShell rastreados foram analisados e todos passaram pelo parser do Windows;
- o artefato local existente `Agent/dist/PrintFlow-Agent-Setup.exe` não foi sobrescrito durante a validação;
- a assinatura foi identificada como `DEV_SELF_SIGNED`, com sujeito `CN=PrintFlow 3D Local Dev`; o Windows reporta cadeia não confiável, conforme esperado para Early Access/Pilot;
- não foi instalado certificado na Trusted Root, nem desabilitado SmartScreen/UAC;
- `PRODUCTION_TRUSTED` permanece bloqueado externamente até existir certificado Code Signing confiável.

Validação:

- teste confirma que configuração e runtime/heartbeat reportam a mesma versão;
- `node --check Agent/src/agentInfo.js` e `git diff --check` passaram.

==================================================
PRÓXIMO PASSO OBRIGATÓRIO
==================================================

Após esta auditoria, iniciar pelo P0.

Não iniciar novas etapas de storage; o Cloudflare R2 já é o provider definido.
Slicing, installer final,
auto-update ou funcionalidades P2 antes da fundação necessária.

Ordem imediata:

0. Segurança e preparação do repositório:
   - auditar arquivos atualmente rastreados;
   - auditar histórico por secrets;
   - fortalecer .gitignore sem remover arquivos legítimos;
   - configurar secret scanning;
   - criar Production Config Validator;
   - centralizar DEVELOPMENT/PRODUCTION;
   - configurar CI Production em checkout limpo;
   - confirmar que ambiente local permanece Development.

1. PrinterAdapter/capabilities;
2. SQLite local com schema versionado;
3. processed_commands;
4. idempotência de start_print;
5. claim atômico + lease;
6. sync_outbox;
7. proteção/rotação da credencial;
8. logs estruturados;
9. WebSocket autenticado;
10. reconnect/backoff;
11. polling fallback;
12. testes de restart/retry.

Ao concluir esses itens, executar os critérios formais de conclusão
do P0 antes de avançar para o próximo estágio.

==================================================
REGISTRO DE EXECUÇÃO — P1 FILEMANAGER / RANGE / CACHE PINADO
==================================================

Em 2026-09-19 foi implementado o próximo item independente após a
fundação P0, preservando o download completo como fallback:

- `GET /api/agents/print-file` continua autenticado pelo Agent e agora
  aceita uma única faixa `Range: bytes=start-end`, retornando `206`,
  `Content-Range` e `Accept-Ranges`; faixas inválidas retornam `416`.
- `openPrintFileReadStream` aceita limites de leitura sem alterar a chave
  de storage nem a autorização por tenant.
- `Agent/src/files/fileManager.js` passou a concentrar a fachada de cache,
  pin e unpin; autorização e metadata continuam sendo responsabilidade do
  Backend, sem mover regra de negócio para o Agent.
- O cache do Agent usa arquivo `.part` estável, envia `Range` quando há
  parcial, continua em `206`, reinicia em `200` quando o servidor não
  suporta resume e remove parcial inválido após falha de hash.
- Interrupções preservam o `.part` para a próxima tentativa; o arquivo
  final só aparece após tamanho e SHA-256 conferirem.
- Arquivos usados durante `start_print` recebem marcador `.pin` e são
  excluídos da limpeza de idade/LRU durante a operação; o marcador é
  removido em `finally`.
- `.part` é tratado como temporário e continua sujeito à retenção de
  temporários, evitando lixo permanente.

Também foi concluído o primeiro recorte de sincronização operacional:

- SQLite agora está no schema v3 e possui `agent_events` e `local_states`, com tentativas,
  persistência após reinício e remoção somente após confirmação da API;
- o Agent persiste o último estado agregado conhecido de impressoras e jobs,
  sem transformar o SQLite em cópia completa do Cloud;
- conclusões novas de comandos geram apenas um evento agregado seguro
  (`command.completed`), sem temperatura por segundo nem payload de
  impressora/credenciais;
- `POST /api/agents/sync-events` autentica o Agent, deriva o tenant da
  identidade validada, limita lotes a 50 e deduplica pelo Agent + id local
  antes de registrar a auditoria operacional;
- a migration aditiva cria `agent_event_receipts` com chave primária por
  tenant/Agent/evento e RLS, tornando o retry idempotente no banco;
- falha de rede mantém o evento local para retry com backoff do ciclo de
  comandos existente.

Descoberta LAN também recebeu um limite seguro:

- a faixa agora é calculada pela `netmask` real da interface, em vez de
  assumir sempre `/24`;
- redes maiores são limitadas a 1024 hosts por execução por padrão
  (`PRINTFLOW_DISCOVERY_MAX_HOSTS`, com teto de 4096), mantendo lotes de
  20 e timeout existente;
- a função de cálculo possui testes para `/24` e rede maior truncada;
- mDNS e validação com hardware real continuam pendentes, e o mock Bambu
  permanece apenas quando explicitamente habilitado em desenvolvimento.

Proteção local de credenciais:

- no Windows, `agent.json` agora grava somente payload protegido por DPAPI
  `LocalMachine`; o segredo não aparece no arquivo em texto puro;
- instalações legadas continuam sendo lidas e são migradas na próxima
  leitura/gravação;
- em plataformas não-Windows, o fallback compatível usa permissões `0600`
  e permanece explicitamente inferior à proteção DPAPI;
- a rotação operacional continua sendo feita pelo re-pareamento controlado,
  que substitui o hash no Cloud sem mudar o Agent/tenant; uma rotação
  remota sem intervenção ainda é pendência.

Validação executada:

- `node --check` nos módulos alterados passou;
- teste direcionado de retomada com servidor HTTP local confirmou o
  cabeçalho Range, append e hash final;
- testes de limpeza confirmaram preservação de arquivo pinado;
- suíte Agent: 36 testes passaram;
- suíte Backend: 115 testes passaram;
- `git diff --check` passou.

Limitações e riscos restantes:

- o smoke test real do Cloudflare R2 e o download direto autorizado ainda
  dependem de executar no ambiente com as novas variáveis;
  o fluxo permanece no Backend por compatibilidade e segurança;
- não foi exercido hardware real, Postgres/Neon ou produção;
- a migration `agent_event_receipts` foi validada estaticamente, mas ainda
  requer execução contra uma instância PostgreSQL de teste;
- a proteção `.pin` cobre a janela de `start_print`; um registro de job
  ativo persistente deverá ser ligado à fila local em etapa posterior.

PRÓXIMO PASSO ATUAL:

Avançar para a abstração de Object Storage no Backend, sem ativar ainda a
implementação concreta: a documentação oficial confirma protocolo S3 e
provisionamento por `neon.ts`, mas não confirma neste checkout o endpoint,
credencial temporária ou fluxo de autorização adequado ao Agent. O Agent
continua proibido de receber credenciais administrativas. A integração
concreta permanece bloqueada até configuração Neon e validação segura do
fluxo oficial.

O contrato mínimo `ObjectStorageProvider` (`put/get/head/delete`) já foi
isolado e testado; nenhum SDK, bucket ou segredo do Neon foi adicionado.

Validação de release também foi fortalecida:

- `scripts/validate-agent-package.mjs` valida em checkout limpo a
  consistência de `package.json`/lock, versão, scripts Windows e arquivos
  essenciais, além de rejeitar `DATABASE_URL` e credenciais persistidas no
  conteúdo do Agent;
- o job `verify` do Agent executa esse verificador antes da suíte, sem
  reconstruir ou sobrescrever o instalador existente;
- validação local: `node scripts/validate-agent-package.mjs` passou.
- o mesmo verificador confirma que o installer interrompe a instância
  anterior, não remove amplamente o diretório e não copia `data`, cache,
  logs, `agent.json` ou o SQLite; isso preserva pareamento e estado em
  upgrade in-place.
### 2026-09-19 — preparação de storage local e ambientes do Agent

Foi adicionada uma primeira implementação local do contrato de object
storage para validação sem dependência externa:

- `BackEnd/src/services/localObjectStorageProvider.js` grava objetos com
  escrita temporária e rename atômico;
- as chaves são normalizadas e impedidas de escapar do diretório raiz;
- `put`, `get`, `head` e `delete` foram exercitados com stream e limpeza;
- `BackEnd/test/local-object-storage-provider.test.js` cobre o ciclo e a
  tentativa de traversal.

Também foi centralizada a separação `DEVELOPMENT`/`PRODUCTION` no Agent:

- `Agent/src/config/config.js` rejeita endpoints locais/HTTP/WS e mock Bambu
  quando o ambiente é `PRODUCTION`;
- os lançadores Windows existentes passam explicitamente
  `PRINTFLOW_ENVIRONMENT=PRODUCTION`;
- o runtime do Agent usa a configuração centralizada, mantendo localhost
  somente no desenvolvimento.

Validação desta etapa:

- `node --check` dos módulos de configuração e runtime passou;
- suíte Agent: 37 testes passaram;
- suíte Backend com teste direcionado do provider local: 30 testes passaram.

Registro histórico da decisão de produto: o usuário solicitou a substituição
do storage principal anteriormente considerado por Cloudflare R2. A decisão
vigente é R2; o provider foi implementado no Backend usando API S3 e URLs
temporárias, sem credenciais no Agent. A migração mantém compatibilidade com
os arquivos locais antes da troca definitiva de leitura.
### 2026-09-19 — provider Cloudflare R2 isolado

O provider R2 foi implementado de forma explícita e selecionável por ambiente:

- `BackEnd/src/services/r2ObjectStorageProvider.js` usa o SDK S3 oficial,
  região `auto` e endpoint por Account ID;
- suporta `put`, `get`, `head`, `delete` e URLs pré-assinadas para leitura e
  escrita, limitadas a no máximo sete dias;
- `BackEnd/src/services/configuredObjectStorage.js` seleciona `local` ou
  `r2` por `OBJECT_STORAGE_PROVIDER`;
- nenhuma credencial foi adicionada ao repositório ou ao Agent;
- testes usam cliente S3 simulado e confirmam comandos, presign e proteção
  contra traversal;
- dependências adicionadas: `@aws-sdk/client-s3` e
  `@aws-sdk/s3-request-presigner`.

Validação: suíte Backend completa com 118 testes passou. O upload real ainda
depende de executar o smoke test no ambiente que possui as novas credenciais
R2; nenhum segredo foi exposto ou gravado no repositório.
### 2026-09-19 — integração compatível do fluxo de arquivos

O caminho existente de arquivos agora seleciona o provider R2 quando
`OBJECT_STORAGE_PROVIDER=r2`:

- upload de arquivo de produto mantém a cópia local temporária/fallback,
  calcula hash e envia o objeto ao R2 com a mesma `storageKey` tenant-scoped;
- download do Agent consulta `head/get` no provider R2 e preserva suporte a
  `Range`, `206` e validação de tamanho;
- com `OBJECT_STORAGE_PROVIDER=local`, o comportamento anterior permanece;
- nenhuma troca automática de dados existentes ou limpeza destrutiva foi
  executada.

Validação: `node --check` dos serviços de storage e a suíte Backend completa
(118 testes) passaram. Ainda falta somente o exercício contra um bucket real
com credenciais novas e revogadas as credenciais expostas anteriormente.
### 2026-09-19 — Production Config Validator para R2

O validator de Production agora valida, quando `OBJECT_STORAGE_PROVIDER=r2`:

- Account ID, bucket, Access Key ID e Secret Access Key presentes;
- endpoint S3 HTTPS sem bucket embutido, query ou fragmento;
- configuração válida com valores fictícios;
- rejeição de endpoint contendo o nome do bucket no path.

Os testes manuais do script passaram para os casos válido e inválido. Nenhum
segredo real foi utilizado.
### 2026-09-19 — CI valida configuração Production com R2

O job de segurança do CI agora exercita o ramo `OBJECT_STORAGE_PROVIDER=r2`
com valores fictícios, validando endpoint HTTPS sem bucket no path e todas as
variáveis obrigatórias. Nenhuma credencial real é usada no CI.
### 2026-09-19 — smoke test controlado do R2

Foi criado `scripts/r2-smoke.mjs` e o comando `npm run storage:smoke` no
Backend. O teste exige as variáveis R2, cria uma chave temporária aleatória,
valida `put/head/get` por conteúdo e remove o objeto em `finally`; não imprime
segredos nem URLs assinadas. Sem variáveis configuradas, encerra com bloqueio
explícito e não tenta uma conexão implícita.
### 2026-09-19 — validação local e tentativa de Production

Validação local concluída:

- Backend: 118 testes passaram;
- Agent: 37 testes passaram;
- `validate-agent-package.mjs` passou;
- `check-production-config.mjs` passou com configuração R2 fictícia;
- nenhum segredo local foi lido ou exibido.

A verificação somente leitura de `https://printflow-api-4y5l.onrender.com/healthz`
não recebeu resposta: a tentativa direta falhou por conexão e a tentativa
fora do sandbox expirou após 30 segundos. Isso não prova falha do R2; apenas
deixa o deploy/URL de Production não verificado. O smoke test real ainda
depende de executar no ambiente que possui as novas variáveis R2.
### DECISÃO VIGENTE — substituição de Neon Object Storage por Cloudflare R2

A decisão do usuário substitui integralmente as referências anteriores a
Neon Object Storage nesta auditoria. Elas permanecem apenas como histórico
da análise inicial e não são mais requisitos de implementação.

O storage persistente vigente é Cloudflare R2, acessado exclusivamente pelo
Backend através da API S3. O Agent recebe apenas autorização temporária ou
acessa a API do PrintFlow; nunca recebe credenciais administrativas do R2.

Aplicam-se agora os seguintes nomes e critérios:

- `R2ObjectStorageProvider` é a implementação concreta vigente;
- `OBJECT_STORAGE_PROVIDER=r2` é a configuração de Production;
- `OBJECT_STORAGE_PROVIDER=local` é somente fallback/desenvolvimento;
- PostgreSQL/Neon continua sendo apenas banco de dados e metadata;
- migração local → R2 deve preservar hash, tenant, fallback e limpeza
  auditada.

### 2026-09-19 — validação local sem Docker/Postman

Por solicitação do usuário, foram executadas as suítes automatizadas sem
Docker ou Postman: Backend (119 testes), Agent (39 testes), verificação de
sintaxe, validador do pacote e `scripts/check-agent-p0-contract.mjs` (9
contratos estáticos). Essa evidência confirma o comportamento local e a
presença dos contratos de lease, rotação, WebSocket e DPAPI; não substitui a
execução da migration/RLS em PostgreSQL real.

### 2026-09-19 — P0: WebSocket autenticado e lease de comandos

Após autorização explícita para alterações de autenticação e comando, foi
adicionado um canal WebSocket autenticado em `/api/agents/ws`. Ele aceita
somente `x-agent-id` e `x-agent-secret` no handshake, transmite apenas o
sinal `command_available` e não recebe payload do cliente. SSE e polling
continuam ativos como contingência, sem expor comando, tenant ou segredo no
evento.

Também foram adicionados de forma aditiva a `agent_commands` os campos
`accepted_at`, `lease_expires_at` e `attempt`, além de índice de busca. O
claim define lease de três minutos e a expiração passa a respeitar esse lease;
conclusão e revogação limpam o lease. Nenhum comando ou dado existente foi
apagado.

Validação local: Backend 119 testes passou; Agent 38 testes passou;
validador de pacote do Agent e `git diff --check` passaram. A migration ainda
requer execução contra PostgreSQL real e o WebSocket contra o deploy Render
antes de considerar P0 validado em Production.

### 2026-09-19 — P0: rotação progressiva de credenciais

O Backend agora mantém versão da credencial e uma credencial pendente de
curta duração. O Agent inicia a rotação somente após a janela de 30 dias,
persiste a nova credencial sob DPAPI antes da confirmação e confirma usando
o segredo pendente. Por até 15 minutos, somente o Agent autenticado pode
confirmar a transição; confirmações repetidas são idempotentes. Novo
pareamento limpa qualquer transição pendente. Segredos não são persistidos
em texto puro no banco, logs ou resposta administrativa.

Validação: sintaxe, suítes Backend (119) e Agent (38), e `git diff --check`
passaram. Falta executar a migration e testar a rotação contra PostgreSQL
real antes de declarar o mecanismo validado em Production.

### 2026-09-19 — bloqueio externo de validação PostgreSQL

Foi verificada a máquina local para validação integrada: `docker`, `podman`
e `psql` não estão instalados/disponíveis. Portanto não há como executar
com segurança a migration, RLS, lease e rotação em PostgreSQL real neste
checkout. O bloqueio não afeta as suítes unitárias locais, mas impede declarar
P0 validado em banco/deploy até haver um ambiente PostgreSQL de teste ou uma
execução controlada em infraestrutura externa.

O builder do pacote Windows também rejeita endpoint `http`, localhost,
loopback e `0.0.0.0` antes de gerar o instalador Production. O validador do
pacote passou após essa regra; o instalador existente não foi reconstruído
 nem sobrescrito.

### 2026-09-20 — validacao PostgreSQL local concluida

O PostgreSQL 18 local foi usado em um banco isolado `printflow_agent_test`,
sem alterar banco de desenvolvimento ou producao. A migration executou com
sucesso na primeira execucao e tambem na segunda execucao idempotente. A
conexao local precisou de `sslmode=disable`; o teste foi executado com
`NODE_ENV=production` para impedir que o `.env.local` substituisse os valores
explicitos do ambiente de teste.

Foram confirmados no catalogo do banco os campos de lease (`accepted_at`,
`lease_expires_at`, `attempt`), os campos de rotacao pendente e versao de
credencial, RLS ativo em `agents`, `agent_commands` e
`agent_event_receipts`, alem das politicas correspondentes. Um usuario SQL
temporario, sem privilegios de superusuario, confirmou isolamento: cada
tenant enxergou apenas seu agente e o tenant A nao enxergou o comando do
tenant B. O usuario, dados e privilegios temporarios foram removidos apos o
teste.

Esta evidencia valida a migration e o isolamento local; ainda nao valida
WebSocket, R2 real ou comportamento do Render em producao.

### 2026-09-20 — evidencia adicional de reconexao WebSocket

O teste do Agent passou a exercer uma queda de conexao e a reconexao
subsequente, verificando o primeiro atraso de backoff de 1 segundo. A suita
do Agent passou para 40 testes, todos verdes. O comportamento de producao
continua com jitter e limite progressivo de 30 segundos; polling e SSE
permanecem como fallback.

Tambem foram executados os gates de checkout local equivalentes ao CI:
configuracao Production com R2 dummy validada, pacote do Agent validado,
build Production do FrontEnd concluido e build Production do AdminFrontEnd
concluido. Esses builds nao alteraram o ambiente Development nem o artefato
existente do installer.

Foi fechado tambem o gate de storage: o Production Config Validator e o
carregamento de ambiente do Backend agora rejeitam `OBJECT_STORAGE_PROVIDER`
diferente de `r2` em Production. O fallback `local` continua permitido
somente em Development/testes. O caminho R2 com endpoint HTTPS e variaveis
completas foi validado; o caminho local em Production foi rejeitado como
esperado.

Foi adicionado o smoke test opt-in `scripts/local-agent-websocket-smoke.mjs`.
Executado contra `printflow_agent_test`, ele autenticou um Agent temporario,
recebeu `ready` e `command_available` pelo servidor WebSocket real e limpou
tenant, Agent e credenciais temporarios ao terminar. Nenhum endpoint de
Production foi alterado.

Na migração local para R2, a leitura agora tenta primeiro o objeto no R2 e,
quando ele ainda nao existe, usa o arquivo local legado com a mesma chave e
suporte a Range. O comportamento foi coberto por teste dedicado; a suite do
Backend passou para 120 testes.

Override vigente do registro historico: o trecho anterior que mencionava
bloqueio do Neon Object Storage nao e mais o proximo passo. A decisao atual
e Cloudflare R2; resta executar o smoke test no ambiente com as variaveis R2
reais e confirmar o bucket sem expor credenciais.

O fluxo `DEV_SELF_SIGNED` foi corrigido: `sign-windows-agent-dev.ps1`
assina e exporta o certificado, mas nao instala mais o certificado em
`Root`/`TrustedPublisher`. A confianca so pode ser adicionada pelo script
explicito `trust-windows-agent-dev-certificate.ps1`; o validador do pacote
agora impede regressao dessa regra.

O timestamp padrão do fluxo DEV foi alterado para HTTPS e o validador do
pacote passou a exigir esse endpoint seguro.

O usuario confirmou a execucao do `npm run storage:smoke` no Render com as
variaveis R2 de Production: o smoke passou. Esta evidencia cobre o ciclo
real do bucket no ambiente de execucao; o health check publico ainda nao foi
confirmado por esta maquina.

Atualizacao posterior: o usuario confirmou que o smoke test real do R2 foi
executado com sucesso no Render. Portanto, o gate do bucket esta concluido;
permanece apenas a verificacao independente do health endpoint publico.

Nova auditoria local de segredos: nenhum arquivo de runtime proibido estÃ¡
rastreado e nenhum padrÃ£o Ã³bvio de credencial foi encontrado. `gitleaks`
nÃ£o estÃ¡ instalado localmente; o secret scan oficial continua sendo o job
Gitleaks do CI. O health check Render continua sem resposta nesta mÃ¡quina,
portanto o deploy permanece nÃ£o verificado.

Foi criado `.github/workflows/agent-release.yml`, acionado exclusivamente por
tags `agent-v*`. O workflow valida a tag contra o SemVer do Agent, executa a
suite, gera ZIP/installer Early Access, publica SHA-256 e cria a release com
`signingMode=DEV_SELF_SIGNED`. Pushes comuns nÃ£o publicam Agent. A assinatura
confiÃ¡vel `PRODUCTION_TRUSTED` continua bloqueada externamente.

O workflow exige ainda as variÃ¡veis de repositÃ³rio
`PRINTFLOW_API_URL` e `PRINTFLOW_MINIMUM_SUPPORTED_VERSION`, evitando
publicar com endpoint ou polÃ­tica de compatibilidade implÃ­citos.

O CI agora executa `scripts/check-agent-release-contract.mjs` antes dos
testes do Agent. O verificador estÃ¡tico confirma tag, SemVer, endpoint,
versÃ£o mÃ­nima, build, SHA-256, metadados, signingMode e publicaÃ§Ã£o via
release; passou localmente com 11 checks.

Foi adicionado `scripts/local-agent-credential-rotation-smoke.mjs` e ele foi
executado contra o PostgreSQL local: a rotaÃ§Ã£o progressiva, a confirmaÃ§Ã£o e
uma confirmaÃ§Ã£o repetida foram exercitadas; a versÃ£o final ficou ativa e a
credencial pendente foi limpa. Tenant, Agent e dados temporÃ¡rios foram
removidos no `finally`.

Foi adicionado `scripts/migrate-local-print-files-to-r2.mjs` (tambem exposto
como `npm run storage:migrate:r2`). A operacao e limitada por `--tenant`, faz
dry-run por padrao e exige `--apply` para copiar. Cada arquivo e comparado com
hash/tamanho do banco; objetos existentes tambem sao baixados e verificados por
hash antes de serem ignorados. A ferramenta nao exclui arquivos locais nem
objetos R2. A execucao real depende das variaveis R2 do ambiente e ainda nao
foi disparada.

Foi reforcado o gate de cada push em `.github/workflows/ci.yml`: alem dos
testes no runner Linux, o CI agora usa `windows-latest` para gerar o pacote
Production do Agent sem publicar release. O job valida a presenca do ZIP,
confere que o launcher recebeu uma URL HTTPS nao-local e expande o ZIP para
confirmar o runtime. Nenhum instalador e publicado por push; a publicacao
continua restrita ao workflow de tag `agent-v*`.

Validacao local desta alteracao: contrato de release (11 checks), validador do
pacote, configuracao Production com R2 ficticio e `git diff --check` passaram.
O runner Windows do GitHub ainda e uma verificacao externa; o pacote local
existente nao foi sobrescrito.

Proximo passo aplicavel: executar, no primeiro CI apos o push, o job Windows
de empacotamento e depois validar o fluxo de release por uma tag Early Access.
Hardware real e certificado `PRODUCTION_TRUSTED` continuam bloqueios externos;
nao impedem o restante da validacao automatizada.

Durante a verificacao final, a suite Backend revelou uma colisao de IP de
teste: o teste aleatorio de rate limit podia escolher o mesmo endereco usado
no teste de troca de senha e produzir `429` indevido. Os IPs desse caso foram
isolados no bloco reservado `127.10.0.0/24`; nenhuma regra de rate limit de
Production foi alterada. A suite Backend passou novamente com 120/120 em duas
execucoes consecutivas.

O migrador local -> R2 tambem foi ajustado para sempre encerrar o pool quando
a consulta do tenant falhar, preservando a execucao segura e sem efeitos
parciais.

Foi feita uma tentativa de empacotamento Windows local em
`Agent/.tmp-agent-package-check`, sem tocar no `Agent/dist` existente. O ZIP de
Production foi gerado e o launcher VBS recebeu a URL HTTPS correta; o
`iexpress.exe` local ficou sem concluir a criacao do `.exe` e o processo foi
interrompido, portanto a verificacao final do instalador permanece atribuida
ao runner `windows-latest` do CI. O diretorio temporario foi removido e nenhum
artefato local existente foi sobrescrito.

O empacotador foi corrigido para aguardar o artefato do IExpress com prazo
limitado e encerrar somente o processo iniciado pelo proprio script quando o
`.exe` ja existe. Tambem foi adicionado cancelamento de execucoes antigas por
branch no CI. Repeticao local com `-OutputDir .tmp-agent-package-check4`
terminou com sucesso e gerou ZIP de 4.629.549 bytes e instalador de 4.341.760
bytes; o launcher foi conferido com HTTPS e sem endpoint local. Os temporarios
foram removidos.

O workflow CI do commit `c118a0e` foi executado no GitHub (run 58,
`35505625741`) e terminou com sucesso. O runner Windows confirmou a geracao
do ZIP e do instalador, e a etapa seguinte expandiu o ZIP e validou o runtime
e o launcher Production. Security, Backend, Agent e os dois frontends tambem
passaram.

O manifesto da release Early Access passou a registrar tambem
`certificateSha256`, derivado do certificado publico que acompanha o
instalador. O contrato estatico do workflow foi atualizado e passou de 11
para 12 verificacoes; isso reforca a conferencia de integridade sem apresentar
o certificado self-signed como confiavel.

O CI do commit `e68d4dd` foi executado no GitHub (run 60,
`35506094563`) e terminou com sucesso, incluindo a verificacao atualizada do
contrato de release e o empacotamento Windows Production.

Foi adicionado `scripts/validate-agent-release-artifacts.mjs`, executado pelo
workflow de release depois da geracao de `SHA256SUMS.txt`. Ele valida o
manifesto, o modo de assinatura, cada hash publicado e a correspondencia de
`certificateSha256`. Um fixture temporario DEV_SELF_SIGNED foi validado
localmente com quatro hashes e removido ao final.

O CI do commit `1fde783` foi executado no GitHub (run 62,
`35506552343`) e terminou com sucesso, incluindo o novo contrato estatico de
13 verificacoes e o empacotamento Windows Production.
