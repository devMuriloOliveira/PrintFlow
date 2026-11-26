# Portal administrativo

## Responsabilidade

O `AdminFrontEnd` é um aplicativo Nuxt 4/Vue 3 separado do painel do cliente. Ele oferece visão operacional da plataforma, suporte, empresas, auditoria e evidências de exclusão.

## Áreas de navegação

- `/login`: entrada restrita para administradores autorizados.
- `/`: indicadores da plataforma, prioridades, fila recente e SLA.
- `/solicitacoes`: fila de suporte, triagem, protocolos e atendimento.
- `/empresas`: empresas, cobrança e planos.
- `/empresas/:id`: uso, assinatura, usuários e histórico da empresa.
- `/auditoria`: eventos administrativos e acessos autorizados por empresa.
- `/exclusoes`: evidências preservadas de exclusões.

## Autorização e auditoria

O portal usa a sessão autenticada da API e verifica o acesso administrativo por uma chamada protegida ao Backend. Menus, rotas visuais e `noindex` não substituem autorização do servidor.

Ações de status, assinatura, preço, SLA, exclusão e acesso a dados de empresa podem afetar clientes ou cobrança. Devem ser exercitadas somente com empresas fictícias ou ambiente autorizado. Exportações e ações administrativas devem preservar o contrato de auditoria do Backend.

## Configuração

Use `NUXT_PUBLIC_API_BASE` para apontar para uma API local ou autorizada. A lista `PLATFORM_SUPER_ADMIN_EMAILS` é configuração privada do Backend e não pertence ao frontend.

## Limites

O build não exercita páginas protegidas, permissões, exportações, auditoria ou efeitos administrativos. Essas áreas exigem validação autenticada em ambiente seguro.
