# Agent: atualização e desinstalação

## Atualização

O host Windows inicia o setup para verificar releases assinadas. O atualizador valida versão, hash, certificado fixado, assinatura, pacote e saúde antes de concluir. O host usa intervalo de sucesso de seis horas e retry de quinze minutos quando há falha, adiamento, falha ao iniciar o setup ou condição transitória.

Uma instalação anterior deve ser preservada até a nova versão passar suas verificações. Rollback e falhas de health não devem deixar uma instalação parcialmente substituída.

## Desinstalação

O modo padrão preserva os dados locais. A remoção completa de dados depende de escolha explícita do usuário. O auxiliar de desinstalação é iniciado antes de remover arquivos, atalhos, registros ou dados; ele espera o processo pai encerrar, verifica a identidade esperada e só então remove a instalação.

O processo remove primeiro a pasta do Agent e depois limpa entradas, atalhos e registros previstos. A limpeza de dados de usuário continua separada da remoção dos binários.

## Proteção do modo de teste

Operações mutáveis em modo de teste exigem uma raiz direta `FilaAgent-E2E-*` em `%LOCALAPPDATA%`, tarefa isolada e dados de teste próprios. O finalizador `--finalize-uninstall` também passa por essa validação e rejeita uma raiz que seja reparse point. O teste negativo confirmou que uma pasta sentinela fora do namespace não é removida.

## Limitações conhecidas

O E2E local cobre instalação, atualização/rollback e desinstalação isolada, mas não comprova todos os cenários de falha de processo auxiliar, remoção completa de dados em máquina real, assinatura confiável em todos os clientes ou publicação da release.

## Interface do Setup — 2026-11-26

Os diálogos de instalação e desinstalação foram reorganizados para destacar versão, ação e preservação dos dados. Na desinstalação, os dados locais padrão continuam preservados sem seleção; a opção de apagá-los fica destacada em um painel separado. A janela também informa que o programa, a inicialização automática e os atalhos serão removidos. A falha do Setup agora orienta a pessoa a consultar o log técnico em vez de mostrar diretamente a mensagem bruta da exceção.

Os contratos do instalador passaram 21/21 e o build Release passou sem avisos/erros. A captura visual em Windows interativo e a verificação em escalas DPI diferentes continuam pendentes; build e contratos não comprovam ausência de corte em tela real.

## Registro de falha do log — 2026-11-26

Se o Setup não conseguir gravar em `%LOCALAPPDATA%\FilaAgentSetup\logs`, ele tenta `%TEMP%\FilaAgentSetup\logs` e mostra o caminho que conseguiu gravar. Se ambos falharem, o diálogo informa que o arquivo não foi criado e apresenta o erro de gravação, sem apontar para um caminho inexistente. Essa alteração foi verificada localmente; a release pública 0.1.36 ainda não contém essa correção.

## Atualização iniciada pela instalação — 2026-11-26

Quando há uma nova versão, o Setup iniciado da pasta instalada transfere a verificação para uma cópia temporária fora dessa pasta e encerra. O worker espera a saída do processo pai antes de baixar e iniciar a atualização assinada. Isso libera a pasta antiga para ser movida durante a substituição quando o Setup em execução já contém esse handoff. O host recebe o resultado como adiamento e mantém o retry de 15 minutos.

O Setup não executa nem reutiliza o OrcaSlicer encontrado na instalação existente. Ele prepara e valida o runtime oficial fixado por hash no diretório temporário antes de substituir a instalação. Atualizações exigem conexão com a internet para obter esse runtime.

Para Setups legados que não implementam o handoff, o novo Setup procura somente executáveis de Setup com caminho dentro da instalação e janela de progresso de atualização. Ele encerra esse verificador sem encerrar o instalador filho, espera até 15 segundos e aborta antes de mover a pasta se o processo não sair. O processo antigo do Host também é encerrado durante a troca; a versão nova inicia logo após a instalação. O intervalo de retry de 15 minutos vale para falha/adiamento e não é uma espera aplicada ao caminho bem-sucedido. Como o verificador legado termina antes de gravar o resultado final, o histórico antigo pode ficar com estado `started`; o E2E confirma o sucesso pelo health da nova versão. O E2E de release prefere a versão 0.1.34 como base para cobrir esse fluxo. Essa compatibilidade ainda depende da validação comportamental na CI Windows; nenhum E2E comprova assinatura confiável em todos os clientes ou atualização em todas as configurações de Windows.
