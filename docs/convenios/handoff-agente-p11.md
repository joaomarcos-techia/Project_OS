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
