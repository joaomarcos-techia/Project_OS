# P11.1 e P11.2: o que o agente de IA usa do Convênios (contrato, 25/11/2026)

**Para quem:** o dono da frente do agente de IA. O PR #28 de hoje é só a correção da assinatura do Gemini e não
contém essas jornadas. O TISS não cria agente concorrente nem altera essa frente.

**Estado:** P11.1 e P11.2 BLOCKED, até a frente do agente implementar as jornadas. O lado TISS está pronto e
provado pela agenda (P4.1, P4.4).

## Contrato (o mesmo da agenda)

| Passo | Função (`src/contexts/health-insurance/scheduling-coverage.ts`) | Regra |
| --- | --- | --- |
| Antes de criar | `checkSchedulingChoice(clinicId, patientId, { insurerId, planId, membershipId, guideType })` | devolve `null` (pode criar) ou a mensagem do motivo: módulo desligado, sem assinatura paga (D24), operadora inativa, carteirinha de outra operadora. Escolha inválida não cria atendimento |
| Criar | a agenda cria o atendimento **já** como convênio (`billingMode: 'convenio'`) | o banco recusa convênio sem o módulo ou sem assinatura ativa. Nunca existe janela "particular" com sinal ou link de saldo |
| Depois de criar | `recordSchedulingCoverage({ clinicId, userId, patientId, procedureId, appointments, choice, requestContext })` | nunca lança. Sem carteirinha (`membershipId: null`), o atendimento fica como convênio com **pendência para a recepção**, nunca como cobrança |

## O que o agente não faz (regras que valem para ele)

- não pede nem grava o **número** da carteirinha pela conversa: a recepção registra em Convênios (dado cifrado,
  leitura auditada);
- não informa valor de convênio, glosa ou coparticipação, porque o paciente não vê esses valores;
- só oferece operadoras e planos **ativos** da clínica. A lista de "convênios aceitos" das configurações do agente
  é informativa e não substitui a checagem;
- não age em trial nem sem direito pago: a central de acesso do #53 já barra a entrada do agente.

## Testes que a frente do agente precisa trazer (P11.2)

1. Agendar convênio com operadora ativa: o atendimento nasce convênio, e a cobertura nasce pronta ou pendente.
2. Operadora inativa ou módulo desligado: nada é criado e a resposta diz o motivo.
3. Trial ou assinatura cancelada: o agente não age.
4. Paciente sem carteirinha: convênio com pendência; nenhum sinal nem link de pagamento enviado.
5. Outra clínica: a operadora de uma clínica não aparece para outra.
6. E2E da jornada pela conversa, com dados sintéticos.

## Pacote de implementação para a frente do agente (26/11/2026)

**Estado do #28 (`28279c0d`, só leitura):** base na main de **05/10/2026** (`772f70ad`), sete semanas atrás. Contra a
main atual, o diff tem 836 arquivos. Antes de qualquer jornada de Convênios, o #28 precisa de rebase sobre a
integração comercial (#64), e depois sobre o #55. A correção do Gemini (assinatura de pensamento) fica **separada**,
no próprio #28 ou num PR curto, e não se mistura com o domínio TISS.

### Peças (nenhum agente novo; ferramentas no registro que já existe, `src/contexts/ai-agent/tools/`)

| Ferramenta | O que faz | Do Convênios (público) |
| --- | --- | --- |
| `list_insurance_options` (nova) | lista operadoras e planos **ativos** da clínica; com o módulo desligado, diz "esta clínica não atende convênio pelo Qoro" | `getSchedulingInsuranceOptions(clinicId)` → `{ enabled, insurers[{ id, name, plans[] }] }` (`null` = schema ausente: tratar como desligado) |
| `prepare_appointment` (existente) | ganha a modalidade (`particular` ou `convenio` com `insurerId`/`planId`) | antes de confirmar: `checkSchedulingChoice(clinicId, patientId, choice)` → `null` ou o motivo |
| `confirm_appointment` (existente) | cria pela agenda com `billingMode: 'convenio'` quando for o caso | depois de criar: `recordSchedulingCoverage(...)` (nunca lança; sem carteirinha = pendência da recepção) |

Exportar `getSchedulingInsuranceOptions` pelo `index.ts` do Convênios no mesmo PR (hoje a agenda importa direto de
`config-queries`; o agente, de outro contexto, só pode usar a superfície pública).

### As cinco jornadas (critério de P11.2; dados sintéticos)

| # | Jornada | Paciente diz | O agente faz | Nunca faz |
| --- | --- | --- | --- | --- |
| 1 | **Particular** | "quero marcar uma consulta" | segue o fluxo atual, sem mencionar convênio | mudar sinal, preço ou link do particular |
| 2 | **Convênio aceito** | "tenho Unimed" (ativa na clínica) | oferece só os planos ativos dela; cria como convênio; avisa que a recepção confere a carteirinha | pedir o número da carteirinha; enviar sinal ou link de pagamento |
| 3 | **Convênio não aceito** | "tenho a operadora X" (não cadastrada, inativa ou módulo desligado) | diz que a clínica não atende esse convênio pelo Qoro e oferece particular ou falar com a recepção | criar o atendimento como convênio; prometer reembolso |
| 4 | **Dúvida de cobertura** | "meu plano cobre esse exame?" | responde que quem confirma cobertura é a operadora/recepção e oferece passar para a recepção (handoff) | afirmar cobertura, elegibilidade ou valor; consultar operadora |
| 5 | **Procedimento com autorização** | pede um procedimento que o plano exige autorizar (`requiresAuthorization` no cadastro do procedimento por operadora) | agenda como convênio e avisa que a clínica precisa da **autorização da operadora** antes do atendimento; a pendência fica para a recepção | dizer que está autorizado; inventar senha ou prazo de autorização |

Regras que valem nas cinco: só depois do **contrato pago** com Convênios (a central de acesso do #53 já barra o
agente em trial); só com as **permissões** que a sessão do agente tem hoje; nenhum faturamento automático (guia,
lote e cobrança continuam na recepção); nenhum dado clínico na conversa.

### Testes que acompanham o PR do agente

- unitários das três ferramentas com o Convênios mockado: módulo desligado, operadora inativa, outra clínica
  (isolamento), carteirinha ausente, autorização exigida;
- guardas: a resposta nunca contém "coberto", "autorizado" ou valor de convênio (teste de saída);
- `scripts/smoke-agent-journeys.ts`: as cinco jornadas ponta a ponta contra o banco descartável (o padrão dos
  harnesses `scripts/security/*-db.ts`), mais o E2E pela conversa no Preview quando o custo permitir.

**Classificação:** P11.1 e P11.2 seguem **BLOCKED** pela frente proprietária. O lado do Convênios está pronto e
provado pela agenda.

## 28/11/2026 — o lado do Convênios implementado e provado (o agente só consome)

Tudo pela superfície pública `@/contexts/health-insurance` (o agente é outro context):

| Para a ferramenta | Chamar | Devolve |
| --- | --- | --- |
| `list_insurance_options` | `agentInsuranceOptions(await getSchedulingInsuranceOptions(clinicId))` | `{ kind: 'options', insurers }` (só ativos da clínica) ou `{ kind: 'not_available', reply }` |
| entender "tenho X" | `matchInsurerFromPatientText(options, fala)` | a operadora, só se UMA casar pelo nome inteiro; senão `null` (perguntar de novo) |
| `prepare_appointment` (convênio) | `agentChoiceVerdict({ refusal: await checkSchedulingChoice(...), requiresAuthorization: await procedureRequiresAuthorization(clinicId, { insurerId, planId, procedureId, guideType }) })` | `{ allowed: true, billingMode: 'convenio', notices }` ou `{ allowed: false, reply, internalReason }` (o motivo técnico vai para a recepção, nunca ao paciente) |
| `confirm_appointment` | criar pela agenda com `billingMode: 'convenio'` e depois `recordSchedulingCoverage(...)` | (já existia; nunca lança) |
| "meu plano cobre?" | `coverageQuestionReply()` | frase segura + `handoff: true` |
| antes de enviar qualquer frase sobre convênio | `findUnsafeAgentClaims(texto)` | lista do que a frase afirma indevidamente (cobertura, autorização, elegibilidade, valor, número da carteirinha); vazio = pode enviar |

**Provas:** `agent-insurance.test.ts` 16/16 (as cinco jornadas e a guarda) e `scripts/security/agent-insurance-journeys-db.ts`
8/8 contra o banco descartável com as consultas reais (só ativos, isolamento entre clínicas, módulo desligado, jornadas
2, 3 e 5, guarda de saída, nenhuma escrita). O harness também entra no gate de cobertura.

**O que continua com a frente do agente (P11.1/P11.2 BLOCKED só por isso):** ligar essas funções às três ferramentas do
registro existente (`src/contexts/ai-agent/tools/`), depois do rebase do #28 sobre o comercial e o #55, e o E2E da
conversa no Preview. Nenhum agente novo.

## 28/11/2026 (tarde) — P11.1 ligada às ferramentas reais do agente (no #55)

**Por que no #55 e não no #28:** as ferramentas do agente moram no código da `main` (`src/contexts/ai-agent/tools/`),
que o #55 já contém. O #28 (`28279c0d`) é só a correção da assinatura de pensamento do Gemini, numa base de 05/10, e
toca outros arquivos (`src/lib/ai/*` e 9 linhas do `inbound-received.ts`). A branch do #28 **não foi alterada**.
Nenhum agente novo: a ligação é no registro existente, com a mesma whitelist (G9) e a mesma porta (`validateAndExecute`).

**Correção do mapeamento deste documento:** quem CRIA o atendimento não é o `confirm_appointment` (que confirma presença
numa consulta que já existe), e sim a ação preparada executada por `confirm_pending_action` (`executePendingAction` →
`schedulingApiV1.scheduleAsAgent`). É ali que o convênio entra.

| Ferramenta | O que mudou |
| --- | --- |
| `list_insurance_options` (nova, só leitura; 16ª da whitelist) | só NOMES das operadoras e planos ativos da clínica do contexto (nunca ids, nunca de outra clínica); módulo desligado ou sem operadora ativa = "o agendamento pelo convênio nesta clínica é feito pela recepção" (nunca "não atendemos": a clínica pode atender convênio fora do sistema); falha de banco = frase segura (fail-closed) |
| `prepare_appointment` | ganhou `insurer_name` e `plan_name` (texto do paciente). O servidor resolve a operadora ATIVA pelo nome inteiro (ambíguo = pergunta de novo; não reconhecido = mostra as ativas), o plano, a carteirinha que a recepção já cadastrou (só o id; o número e os últimos dígitos nunca vão à conversa), o tipo de guia e a autorização pelos contratos vigentes (`schedulingTermsForProcedure`) e confere com `checkSchedulingChoice`. Convênio exige paciente cadastrado. Sem prévia de sinal; o resumo só avisa a carteirinha (e o aval da operadora, se o contrato exigir) |
| `confirm_pending_action` (execução) | o payload cifrado carrega `insurance`; no "SIM" a escolha é **conferida de novo** (operadora suspensa, módulo desligado ou assinatura encerrada entre os turnos = recusa e nada criado); o atendimento nasce `billingMode: 'convenio'` e a cobertura é registrada logo depois, como **automação** (`recordSchedulingCoverage` com `userId: null`; o agente não tem pessoa na sessão). A resposta do servidor não fala de sinal |
| guarda de saída (`inbound-received.ts`) | só no texto LIVRE do modelo (os textos do servidor são seguros por construção) e só quando a frase fala de convênio: afirmar cobertura, autorização, elegibilidade ou valor, ou pedir o número da carteirinha, troca a resposta inteira pela frase segura, com registro em `ai_failures` (`stage: guard`) e métrica `ai_agent.insurance_guard.blocked` |
| prompt (`PROMPT_VERSION` v18) | regra de marcar pelo convênio; a regra v13 (convênios informativos por `provide_clinic_info`) fica igual |

**Efeito em Production quando o #55 for integrado (registrado para o release):** com o módulo desligado em todas as
clínicas reais, a única mudança visível é que um paciente que pedir para marcar pelo convênio recebe "o agendamento
pelo convênio nesta clínica é feito pela recepção…" em vez de o modelo improvisar. Nenhuma ativação de TISS, nenhuma
escrita de Convênios.

**Provas:**
- unitários: `agent-insurance.test.ts` 25/25, `list-insurance-options.test.ts` 6/6, `prepare-appointment.test.ts` 24/24
  (11 de convênio), `pending-action-insurance.test.ts` 6/6, `pending-confirmation.test.ts` 14/14, `register.test.ts`
  4/4, `system.test.ts` 26/26; suítes inteiras de `ai-agent` e `health-insurance` sem regressão (as 3 falhas locais são
  o `xmllint-wasm` ausente no `node_modules` do notebook, conhecidas; no CI ele existe);
- banco: `scripts/security/agent-insurance-tools-db.ts` (porta 55642, 10 provas) roda as ferramentas REAIS pelo registro,
  com as migrations todas: isolamento, módulo desligado, jornada 2 ponta a ponta (atendimento `ai_agent` convênio,
  cobertura `automation` sem usuário, auditoria, fora do sinal/saldo, nenhuma guia nem cobrança), carteirinha
  cadastrada, jornada 5 com SP/SADT, operadora suspensa entre o resumo e o "SIM", contato sem cadastro, particular
  intacto e nenhuma frase indevida. Entra no workflow sintético e no gate de cobertura (43 harnesses).

**O que fica para a P11.2:** o E2E da conversa com o modelo de verdade (Gemini) no Preview. Ele gasta tokens do provedor
e depende de WhatsApp/Preview do agente, então só roda com autorização de custo; o roteiro é o das cinco jornadas acima,
com `scripts/gemini-live-check.ts` e dados sintéticos.

**Conflito previsto com o #28 no rebase dele:** só o `inbound-received.ts` (ele muda 9 linhas no tratamento do
provedor; aqui entram o import, a variável `modelFreeText` e o bloco da guarda depois do pós-guard clínico). Resolução
mecânica, sem sobreposição de linhas.
