# Agent: instalação e ciclo de vida

## Papel do Agent

O Fila Agent é o aplicativo Windows que faz a ponte entre o Filamind e impressoras locais. Ele comunica-se com o Backend, recebe comandos e devolve heartbeat, status e resultados. Não acessa o PostgreSQL e não é a fonte oficial de dados comerciais.

## Instalação

O setup C# valida o pacote, o OrcaSlicer portátil oficial e os parâmetros do ambiente antes de substituir uma instalação existente. Instalações novas usam `%LOCALAPPDATA%\FilaAgent`; o resolvedor preserva a instalação legada `%LOCALAPPDATA%\PrintFlowAgent` quando ela já existe.

O pacote inclui o runtime Windows e uma cópia local validada do OrcaSlicer x64 2.4.2. A instalação não depende da Microsoft Store ou do WinGet. A versão do pacote e os requisitos de compatibilidade devem ser conferidos no `Agent/package.json`, no Backend e no artefato de release.

## Pareamento e inicialização

O site gera um código temporário, o Agent envia esse código ao Backend e salva a credencial local protegida por DPAPI. O setup registra `fila-agent://` para abertura pelo site e configura a inicialização do Agent conforme o fluxo Windows documentado.

## Limites de segurança

- O Agent não recebe `DATABASE_URL`.
- O Agent usa a API configurada para o ambiente; produção exige HTTPS e configuração oficial.
- Dados e credenciais locais são específicos do perfil Windows e não devem ser copiados para outro usuário.
- Uma instalação de teste deve usar diretórios, tarefas e dados isolados.
