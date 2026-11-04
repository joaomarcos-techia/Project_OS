# Continuidade do atendimento e prontidão de cobrança

Escopo aprovado em 04/11/2026: corrigir os problemas de continuidade identificados na investigação, sem alterar atendimentos, consentimentos, contratos ou cobranças reais. Não há autorização de publicação em Production nesta rodada.

## Mudanças

- Encaminhamentos com motivo servidor `clinical_emergency` recebem prioridade urgente. Uma entrada aberta pode ser elevada, sem trocar responsável, alterar o prazo existente ou criar duplicação. Mensagens novas com sinal de emergência durante atendimento humano elevam a prioridade sem voltar ao LLM nem enviar uma resposta concorrente.
- A recusa clínica oferece ajuda para agendar, sem afirmar que vai criar uma consulta. Falhas temporárias oferecem nova tentativa/contato humano, sem prometer encaminhamento ainda inexistente. A recusa fixa é compatível com o próprio guard de saída.
- Leituras idênticas já respondidas no mesmo turno não rodam novamente. Uma rodada que só repete informação encerra com resposta honesta e registro `tool_read_repeated`. O teto continua três rodadas e uma mutação; `tool_rounds_exceeded` agora deixa motivo persistido.
- Todas as rodadas de chamadas permitidas permanecem no JSON de auditoria, com número de rodada e a whitelist anterior. Nome, CPF, motivo, texto clínico e assinatura opaca do provedor não são adicionados aos metadados. Chamada solicitada não equivale a ação executada.
- O histórico explica que a IA está pausada durante atendimento humano, inclusive quando alguém responde pelo aplicativo Business; usa a ação existente de devolução, sem repetir automaticamente mensagens antigas. A urgência mostra orientação de revisão pela equipe.
- A clínica pode cadastrar informações operacionais de atendimento online, infantil e regras de retorno em `/configuracoes/agente`. São dados factuais, não prompt editável ou regras clínicas. Vazio significa informação não cadastrada, não negativa. Perguntas reconhecidas recebem o resultado da ferramenta sem novas rodadas do modelo. Pedidos explícitos de marcar não são substituídos por FAQ.
- Foram retiradas do prompt instruções antigas sobre argumentos de preço por meio de pagamento que já não existem na ferramenta. Não há mudança de preço, política comercial ou contratos.
- `/configuracoes/pagamentos` explica os quatro estados de configuração e os pré-requisitos de recebível, conclusão real, pagamento na recepção e consentimento. Não liga sinal, não concede opt-in e não cria cobrança.

## Migration 0135

`0135_ai_clinic_operational_info.sql`: adiciona `ai_clinic_config.operational_info`, JSON objeto não nulo com default vazio e limite de tamanho. Não remove colunas, reescreve regras financeiras ou preenche informações de clientes.

**DEV: aplicada com autorização específica**, histórico 135 → 136. Hash SHA-256:
`ff1655034997a99667c9aade34d0f1c97b0fdde436a1f880e37501f0acf28119`.
Comparação em transação confirmou configurações anteriores, planos, assinaturas e journal anterior preservados. As 21 configurações preexistentes receberam somente `{}` no novo campo. Production não foi alvo.

O primeiro executor de aplicação abortou na conferência de histórico: comparou estruturas `Result` do driver com uma cópia comum de array. A transação reverteu, sem aplicação parcial. A comparação foi ajustada para representação JSON das mesmas linhas; preflight completo repetido, depois aplicação e verificação final passaram. Nenhum gate ou hash foi removido.

Antes de publicar o app em Production será necessário autorizar a 0135, conferir preflight/backup, aplicar a coluna e só então publicar o código que a consulta. Em rollback do app, preservar o campo aditivo e os fatos novos; não executar DROP nem apagar configurações.

## Provas e limites

- PostgreSQL local descartável com todas as migrations reais: **14/14 cenários PASS**. Inclui preservação da configuração anterior, padrão vazio, normal/urgente, elevação sem perda de responsável/prazo, concorrência, deduplicação, devolução explícita, histórico, validação de JSON e isolamento entre clínicas.
- Nessa mesma prova, entrada → persistência → saga → ferramentas → saída/SQL percorreu código real. **Gemini e Meta foram simulados**, com bloqueio de qualquer fetch inesperado. Foram testados resposta online após uma única chamada, repetição de leitura, teto de rodadas e emergência durante atendimento humano. Não representa entrega externa de WhatsApp nem avaliação do modelo Gemini real.
- Duas falhas de preparação do executor foram corrigidas antes do PASS: slug sintético fora do limite e reprodução incompleta das ACLs gerenciadas do Supabase. Um comando inicial de execução também não propagou `react-server` ao processo TSX; a execução correta usa `tsx --conditions=react-server`. Não foram alterados os grants remotos para passar o teste.
- Tipos, lint, suíte completa, build e navegação de Preview: resultados finais registrados ao encerrar as verificações. Não usar o PASS do release anterior como prova automática deste código.

## O que não mudou

Não houve devolução de conversa real à IA, mudança de prioridade histórica, consulta concluída artificialmente, consentimento presumido, cobrança retroativa, conexão de Asaas, envio ao paciente ou alteração de preço. Emergência não é automaticamente reativada. A fila continua dependente de atendimento humano; prioridade urgente não promete monitoramento externo ou serviço 24 horas.

Não foi implementada separação comercial entre “exigir sinal” e “cobrar depois”: isso precisa de definição própria. O fluxo existente depende da política de sinal, conta recebedora, conclusão e saldo. Dados de modalidade, faixa etária e retorno devem ser preenchidos pela clínica, sem valores inventados pela engenharia.

## Publicação e operação posterior

1. Revisar o PR e os resultados finais de código/Preview.
2. Autorizar separadamente migration 0135 e publicação em Production.
3. Na janela aprovada: backup/preflight; 0135; deployment; smoke de login/configuração/conversas; conferir que clientes legados e política de preços não mudaram.
4. Após publicação, clínica preenche os fatos operacionais em `/configuracoes/agente` e confere endereço e agenda nas configurações existentes.
5. Equipe revisa os atendimentos humanos abertos, com prioridade para urgência. Retomar a IA só quando adequado, usando “Devolver ao agente”; não reexecutar confirmações antigas.
6. Para cobrança, clínica conecta sua conta recebedora, define a política conscientemente, registra consentimentos legítimos e conclusão/pagamento real do atendimento. Não inferir dívida por falta de registro histórico.

O relatório forense com identificadores de conversas reais permanece local e fora do Git. Este documento contém somente comportamento do produto e testes sintéticos.
