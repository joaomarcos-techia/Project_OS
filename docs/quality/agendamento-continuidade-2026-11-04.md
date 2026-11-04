# Continuidade do atendimento e prontidão de cobrança

Escopo aprovado em 04/11/2026: corrigir os problemas de continuidade identificados na investigação, sem alterar atendimentos, consentimentos, contratos ou cobranças reais. Depois da validação no DEV/Preview, o founder autorizou expressamente a janela de Production para a 0135 e o PR #49, revisão `678e027d`.

**Estado final: publicado e verificado em Production.** O [PR #49](https://github.com/joaomarcos-techia/Project_OS/pull/49) foi mesclado em `cd6adc2369558082a7ff34b9a6b2c97f1da58153`; a árvore mesclada foi comparada e é idêntica à revisão aprovada. O deployment `dpl_CXecn3jcW8prPrSz97qEkHTveTdm` está READY e atende `app.qoro.dev`. [Recibo sanitizado da publicação](evidencias/ai-agent-production-20261104.json).

## Mudanças

- Encaminhamentos com motivo servidor `clinical_emergency` recebem prioridade urgente. Uma entrada aberta pode ser elevada, sem trocar responsável, alterar o prazo existente ou criar duplicação. Mensagens novas com sinal de emergência durante atendimento humano elevam a prioridade sem voltar ao LLM nem enviar uma resposta concorrente.
- A recusa clínica oferece ajuda para agendar, sem afirmar que vai criar uma consulta. Falhas temporárias oferecem nova tentativa/contato humano, sem prometer encaminhamento ainda inexistente. A recusa fixa é compatível com o próprio guard de saída.
- Leituras idênticas já respondidas no mesmo turno não rodam novamente. Uma rodada que só repete informação encerra com resposta honesta e registro `tool_read_repeated`. O teto continua três rodadas e uma mutação; `tool_rounds_exceeded` agora deixa motivo persistido.
- Todas as rodadas de chamadas permitidas permanecem no JSON de auditoria, com número de rodada e a whitelist anterior. Nome, CPF, motivo, texto clínico e assinatura opaca do provedor não são adicionados aos metadados. Chamada solicitada não equivale a ação executada.
- O histórico explica que a IA está pausada durante atendimento humano, inclusive quando alguém responde pelo aplicativo Business; usa a ação existente de devolução, sem repetir automaticamente mensagens antigas. A urgência mostra orientação de revisão pela equipe.
- A clínica pode cadastrar informações operacionais de atendimento online, infantil e regras de retorno em `/configuracoes/agente`. São dados factuais, não prompt editável ou regras clínicas. Vazio significa informação não cadastrada, não negativa. Perguntas reconhecidas recebem o resultado da ferramenta sem novas rodadas do modelo. Pedidos explícitos de marcar não são substituídos por FAQ.
  A revisão incluiu pedidos interrogativos, como “Pode agendar meu retorno?”: a presença de `?` não converte uma ação de agenda em resposta de política. Os fatos continuam disponíveis ao modelo, mas não encerram esse pedido automaticamente.
  Pedidos mistos como “Quero falar com um atendente sobre consulta online” também preservam o fluxo de transferência, usando o detector de solicitação humana existente; a ferramenta de informação não encerra o turno como FAQ.
- Foram retiradas do prompt instruções antigas sobre argumentos de preço por meio de pagamento que já não existem na ferramenta. Não há mudança de preço, política comercial ou contratos.
- `/configuracoes/pagamentos` explica os quatro estados de configuração e os pré-requisitos de recebível, conclusão real, pagamento na recepção e consentimento. Não liga sinal, não concede opt-in e não cria cobrança.

## Migration 0135

`0135_ai_clinic_operational_info.sql`: adiciona `ai_clinic_config.operational_info`, JSON objeto não nulo com default vazio e limite de tamanho. Não remove colunas, reescreve regras financeiras ou preenche informações de clientes.

**DEV: aplicada com autorização específica**, histórico 135 → 136. Hash SHA-256:
`ff1655034997a99667c9aade34d0f1c97b0fdde436a1f880e37501f0acf28119`.
Comparação em transação confirmou configurações anteriores, planos, assinaturas e journal anterior preservados. As 21 configurações preexistentes receberam somente `{}` no novo campo. Production não foi alvo.

O primeiro executor de aplicação abortou na conferência de histórico: comparou estruturas `Result` do driver com uma cópia comum de array. A transação reverteu, sem aplicação parcial. A comparação foi ajustada para representação JSON das mesmas linhas; preflight completo repetido, depois aplicação e verificação final passaram. Nenhum gate ou hash foi removido.

**Production: aplicada na janela autorizada em 04/11 às 16:48:55 UTC (13:48:55 de Brasília)**, histórico 135 → 136, com o mesmo hash validado no DEV. A ordem completa anterior foi comparada com o histórico registrado na publicação da 0134, incluindo as diferenças históricas já conhecidas; não foram reescritos hashes nem reaplicadas migrations antigas. O preflight encontrou quatro configurações, tabela de 49.152 bytes e nenhuma transação longa. Uma transação com advisory lock 4242, espera de lock de 5 s e timeout de statement de 20 s aplicou somente a 0135 e sua entrada no journal. A conferência antes/depois confirmou histórico anterior, configurações antigas, perfis, planos, preços e assinaturas preservados; o novo campo JSON começou em `{}` nas quatro configurações e o CHECK está validado. Postflight independente confirmou 136 migrations, coluna e constraint.

Antes da aplicação, o runner existente gerou uma cópia local cifrada de `public`/`auth`, verificou a decifragem e o marcador de conclusão do dump, sem persistir SQL aberto. Arquivo de 695.537 bytes em `backups/`, ignorado pelo Git, com ACL privada e checksum no recibo. Isso não constitui uma nova prova de restore integral nem backup dos binários de Storage; não houve contratação ou upload externo. No Windows, a aplicação da ACL exigiu corrigir a referência do SID para o formato com `*`; a cifra permaneceu presente e a ACL do arquivo foi conferida antes da migration.

A migration foi aplicada antes do código que consulta a coluna. O cadastro permaneceu aberto: a alteração é aditiva e compatível com o código anterior; não foi necessário mudar flag ou fechar o funil. Em rollback do app, preservar o campo aditivo e os fatos novos; não executar DROP nem apagar configurações. A versão anterior registrada para contingência é `dpl_HHYSPzhr2dKhQULK1T5Hn5yCLvgt`, SHA `7b9a7805`; voltar o código não exige reverter o schema.

## Provas e limites

- PostgreSQL local descartável com todas as migrations reais: **16/16 cenários PASS**, execução final em 04/11, saída 0. Inclui preservação da configuração anterior, padrão vazio, normal/urgente, elevação sem perda de responsável/prazo, concorrência, deduplicação, devolução explícita, histórico, validação de JSON e isolamento entre clínicas.
- Nessa mesma prova, entrada → persistência → saga → ferramentas → saída/SQL percorreu código real. **Gemini e Meta foram simulados**, com bloqueio de qualquer fetch inesperado. Foram testados resposta online após uma única chamada, repetição de leitura, teto de rodadas e emergência durante atendimento humano. Não representa entrega externa de WhatsApp nem avaliação do modelo Gemini real.
- O 15º caso confirma que “Pode agendar minha consulta online?” continua para a segunda resposta do modelo depois da ferramenta de informação, sem encerrar como FAQ ou criar encaminhamento. Cinco variações interrogativas têm cobertura unitária. Esse teste confirma a continuidade; não afirma que uma consulta real foi marcada.
- O 16º caso percorre informação → solicitação de humano → fila real persistida, usando o pedido misto de atendente e consulta online. A configuração operacional não impede a transferência explícita. O provedor continua simulado e a clínica é sintética.
- Duas falhas de preparação do executor foram corrigidas antes do PASS: slug sintético fora do limite e reprodução incompleta das ACLs gerenciadas do Supabase. Um comando inicial de execução também não propagou `react-server` ao processo TSX; a execução correta usa `tsx --conditions=react-server`. Não foram alterados os grants remotos para passar o teste.
- Tipos e lint integral locais: PASS. Inventário de segurança: PASS, sem superfícies sem classificação; arquitetura de banco: 0 findings em 1.653 arquivos.
- Primeiro ciclo integral local: 6.094 PASS, duas asserções de texto financeiro reprovadas. As instruções financeiras esperadas foram restauradas no prompt sem remover asserções ou alterar regras. Na revisão `5db86bb7`, a CI executou **6.096/6.096 testes**, 573 arquivos, além de build, bundle, isolamento, tipos, lint e E2E público (**8 PASS, 2 SKIP**). Os SKIPs são os desafios Turnstile sem chaves no build público isolado; esta mudança não altera cadastro ou Turnstile. O estado final agregado da CI e dos demais checks deve ser conferido no SHA atual do [PR #49](https://github.com/joaomarcos-techia/Project_OS/pull/49), sem herdar o resultado de um commit anterior.
- Na revisão interrogativa `9a9a5473`, a suíte integral local passou **6.101/6.101**. Os logs remotos do job `126692441984` também registram **6.101/6.101** e **8 E2E públicos PASS, 2 SKIP**, além dos gates de build e segurança. A API de status ainda mostrou `queued` após os logs completos; não usar essa divergência para substituir os checks obrigatórios ou autorizar merge.
- A última proteção de pedidos explícitos de humano tem cobertura final **42/42** nos testes focados e **16/16** no gate PostgreSQL. A CI final da revisão `678e027d` passou **6.102/6.102**, 573 arquivos, além de tipos, lint, cobertura, arquitetura, inventário, isolamento, migrations, build, bundle e HTTP. O E2E público passou **8 cenários e ignorou 2**, relativos ao Turnstile sem chaves no build isolado. Os checks remotos foram confirmados como SUCCESS antes da publicação; o Vercel Agent Review NEUTRAL não equivale a revisão humana. A CI automática da `main`, já no merge `cd6adc23`, repetiu **6.102/6.102 e 8 PASS/2 SKIP**, encerrando com sucesso na [execução 41871391215](https://github.com/joaomarcos-techia/Project_OS/actions/runs/41871391215).
- O build Next isolado local da revisão `5db86bb7` terminou com saída 0, incluindo compilação, tipos e geração das páginas. O ajuste posterior afeta apenas a decisão de resposta operacional; o build do SHA final deve passar no gate remoto. Avisos preexistentes de cache do webpack/Sentry não foram suprimidos.

## Preview e prova de interface

[PR draft #49](https://github.com/joaomarcos-techia/Project_OS/pull/49). Deployment imutável inspecionado: [Preview `5db86bb7`](https://project-492siubmv-clinic-os-v2-s-projects.vercel.app). Após novo push, usar o deployment associado ao SHA atual para avaliar alterações posteriores. A revisão interrogativa não muda componentes ou estilos das telas inspecionadas.

O Preview `9a9a5473` também chegou a READY: [deployment imutável](https://project-innqisu2o-clinic-os-v2-s-projects.vercel.app). Os últimos ajustes de intenção afetam somente o processamento servidor, sem alterar a interface já inspecionada; não foi criada outra conta nem repetido o E2E de interface sem necessidade.

Em 04/11, 15:51–15:52 UTC, uma fixture exclusiva no DEV passou pelo login real do Supabase e pelas ações reais do servidor no Preview:

1. Salvamento dos três fatos operacionais, conferência por SQL e preservação após recarregar.
2. Exibição dos quatro pré-requisitos de pagamento como pendentes, sem conectar Asaas, criar cobrança ou ativar política.
3. Atendimento humano sem responsável e prioridade urgente visíveis em 1440 px e 390 px; sem overflow horizontal. As duas screenshots foram também inspecionadas visualmente.
4. Clique real em “Devolver ao agente”, fechamento da fila sintética e conversa ativa confirmados no banco.

Conta, sessão e clínica sintéticas foram removidas ao final; readback confirmou ausência da fixture ativa. Não houve conexão Meta/Asaas/Gemini nessa prova. O Supabase Auth e o banco DEV, ao contrário, foram reais. Não se trata de teste de envio de mensagem a paciente.

A primeira tentativa do executor parou no login com seletor de e-mail ambíguo: o DOM possui os campos de login e recuperação. A fixture dessa tentativa foi limpa. O executor passou a usar os IDs existentes `email` e `password`, sem mudar o produto; a segunda execução concluiu os quatro grupos acima. O recibo local registra PASS e cleanup completo em `dist/quality/ai-reliability-preview-ui.json`; screenshots e logs sintéticos permanecem ignorados pelo Git.

### Comandos de reprodução sem clientes reais

```powershell
node node_modules/vitest/vitest.mjs run src/contexts/ai-agent/internal/operational-information.test.ts src/contexts/ai-agent/internal/handlers/read-reuse.test.ts src/contexts/ai-agent/prompts/system.test.ts --maxWorkers=2 --minWorkers=1
node node_modules/tsx/dist/cli.mjs --conditions=react-server scripts/security/ai-handoff-reliability-db.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/tsx/dist/cli.mjs scripts/security/local-build.ts
```

O gate PostgreSQL usa porta local 55496 e cluster sintético descartável com guard de caminho antes da limpeza. Não o aponte para DEV/Production. O executor operacional de migration DEV não deve ser repetido: 0135 já está aplicada. O E2E Preview usou fixture própria com limpeza e exige credenciais legítimas privadas; não há credenciais de teste no repositório.

## Verificação após a publicação

Em 04/11 às 17:02:59–17:03:44 UTC (14:02–14:03 de Brasília), o smoke de Production passou com uma conta de teste preexistente, ativa e identificada como teste. A clínica do cliente investigado foi explicitamente excluída. Nenhuma conta, paciente, consulta ou cobrança foi criada para essa verificação.

- Deployment e domínio confirmados no SHA publicado; login/cadastro públicos responderam 200, sessão anônima ausente respondeu 410 e as três páginas protegidas redirecionaram o anônimo ao login.
- Login real com cookies Secure/HttpOnly, leitura dos três campos novos em `/configuracoes/agente`, ausência de overflow em 1440/390 px, quatro pré-requisitos em `/configuracoes/pagamentos` e carregamento de `/conversas`.
- Nenhum clique de salvar, conectar, cobrar, assumir ou devolver foi executado. Configuração do agente, política de sinal e assinatura da clínica de teste permaneceram iguais. Somente a sessão de refresh do smoke foi revogada com escopo `local`; não foi usado logout global nem alterado o epoch das demais sessões.
- As duas primeiras tentativas pararam numa proteção excessiva do executor: ele tratava todo POST como escrita, bloqueando o túnel Sentry `/monitoring` e a leitura `fetchOpenHandoffs`. Os registros foram preservados como FAIL do executor. A chamada foi conferida no código e no bundle público efetivamente publicado; a execução final permitiu somente o ID exato dessa leitura e a telemetria conhecida, mantendo bloqueadas operações não previstas. Nenhuma validação do produto, permissão ou teste de negócio foi desativado. A execução final e as invariantes passaram.
- Consulta de logs do novo deployment entre o início do smoke e 17:04:58 UTC: **3 registros informativos, nenhum erro encontrado, sem paginação pendente** nos caminhos especificados no recibo. Nenhuma mensagem bruta foi salva. Trata-se de observação curta e com escopo definido, não de prova de ausência de erros em todo o tráfego.

Não foi disparado um novo round trip real paciente → Meta → Gemini → WhatsApp nesta janela. A prova de saga usa banco real e provedores simulados; a prova autenticada usa Production real para leitura. Não se deve declarar que todas as conversas históricas foram resolvidas ou que uma nova mensagem foi entregue com base nesses testes.

## O que não mudou

Não houve devolução de conversa real à IA, mudança de prioridade histórica, consulta concluída artificialmente, consentimento presumido, cobrança retroativa, conexão de Asaas, envio ao paciente ou alteração de preço. A migration e a publicação autorizadas foram as únicas mudanças de produto em Production nesta janela. Emergência não é automaticamente reativada. A fila continua dependente de atendimento humano; prioridade urgente não promete monitoramento externo ou serviço 24 horas.

Não foi implementada separação comercial entre “exigir sinal” e “cobrar depois”: isso precisa de definição própria. O fluxo existente depende da política de sinal, conta recebedora, conclusão e saldo. Dados de modalidade, faixa etária e retorno devem ser preenchidos pela clínica, sem valores inventados pela engenharia.

## Publicação e operação posterior

1. Concluído: resultados finais de código/Preview e checks do PR conferidos.
2. Concluído: autorização específica da 0135 e publicação em Production recebida; não solicitar novamente.
3. Concluído: backup/preflight; 0135; deployment; smoke autenticado; preservação comercial; logs e CI da main.
4. Após publicação, clínica preenche os fatos operacionais em `/configuracoes/agente` e confere endereço e agenda nas configurações existentes.
5. Equipe revisa os atendimentos humanos abertos, com prioridade para urgência. Retomar a IA só quando adequado, usando “Devolver ao agente”; não reexecutar confirmações antigas.
6. Para cobrança, clínica conecta sua conta recebedora, define a política conscientemente, registra consentimentos legítimos e conclusão/pagamento real do atendimento. Não inferir dívida por falta de registro histórico.

O relatório forense com identificadores de conversas reais permanece local e fora do Git. Este documento contém somente comportamento do produto e testes sintéticos.
