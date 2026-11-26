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
