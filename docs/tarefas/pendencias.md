# Pendências verificadas

Esta lista contém somente limitações ou trabalhos ainda não concluídos com evidência no repositório.

## Validação de hardware e APIs reais

- **Escopo:** Agent e adapters de impressoras.
- **Situação:** Bambu e Marlin/mock têm cobertura local maior; OctoPrint, Moonraker/Klipper e PrusaLink ainda exigem validação com dispositivos e versões reais das APIs.
- **Evidência:** limitações registradas no README raiz e no README do Agent.
- **Próximo passo:** executar testes autorizados com hardware de teste e registrar modelo, firmware/API, comandos exercitados e resultado.

## Prova de publicação

- **Escopo:** Vercel, Render, Neon, R2 e release Windows.
- **Situação:** builds e testes locais não comprovam que o artefato publicado, variáveis, webhooks, backups e integrações estão funcionando no ambiente oficial.
- **Próximo passo:** usar uma tarefa de release específica para validar cada fronteira sem misturar evidência local com produção.

## Auditoria histórica do Agent

- **Escopo:** documentação.
- **Situação:** guias temáticos foram criados, mas o arquivo histórico integral ainda não foi movido ou dividido fisicamente.
- **Próximo passo:** mapear seções e links, criar documentos temáticos com referências e só então remover o original do diretório `Agent`.
