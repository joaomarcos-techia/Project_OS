# ADR-048 — Segurança conversacional do agente: pending actions, guard com saída e data server-side

> **Verificação (2026-08-14)**
> **Decisão:** ACTIVE · **Implementação:** IMPLEMENTED
> **Código:** `src/contexts/ai-agent/internal/pending-action.ts`, `guards/semantic-guard.ts`, `internal/relative-datetime.ts`, `internal/handlers/inbound-received.ts` · **Divergência:** —

**Status:** proposed
**Date:** 2026-08-14

## Context

A auditoria de 2026-08-14 (`docs/audits/C12_AI_AGENT_AUDIT_2026-08-14.md`) concluiu **NO-GO** para o agente de WhatsApp. O achado central não foi de segurança — não há tenant escape, IDOR, execução fora da whitelist nem mutação sem consentimento. O que estava quebrado era a **corretude das jornadas obrigatórias**, e três defeitos prendiam o paciente em loop permanente, sem nenhuma válvula de escape.

Dois fatos tornaram esta ADR necessária:

1. **O contrato de pending actions nunca teve ADR.** A confirmação em duas etapas — a invariante mais importante do agente — vivia apenas no header da migration `0056_ai_pending_actions.sql` e no texto do prompt. Uma regra desse peso sem decisão registrada é uma regra que a próxima pessoa reescreve sem saber o que está desfazendo.
2. **A premissa do §7 da ADR-022 era falsa na prática.** Ela afirma que "falso positivo é aceitável (cai no fallback seguro e o médico assume)". O fallback existia; o "médico assume" nunca foi implementado. O turno bloqueado não incrementava contador nenhum, então `MAX_FALLBACKS` jamais disparava e a conversa não chegava a um humano — nunca.

Os defeitos concretos que motivaram cada decisão abaixo estão nomeados como F-01…F-12 na auditoria.

## Decision

### 1. Pending action é o contrato de consentimento (formalizado)

Toda mutação de agenda é **preparada** numa linha de `ai_pending_actions` (payload cifrado per-tenant, TTL de 10 min, `status='pending'`) e só executa quando uma **nova mensagem** do paciente é classificada como confirmação pelo SERVIDOR. Invariantes:

- no máximo uma pendência por conversa — índice único parcial `ai_pending_actions_conversation_pending_uniq`;
- consumo atômico — `SELECT … FOR UPDATE` seguido de `UPDATE … WHERE status='pending'`;
- preparar de novo faz `superseded` na anterior;
- o gate de confirmação é **server-side** e usa o texto ORIGINAL do turno, nunca um argumento que o modelo poderia fabricar.

O modelo decide *chamar* `confirm_pending_action`; o servidor tem poder de veto. Os dois precisam concordar.

### 2. A confirmação exige uma mensagem SÓ-AFIRMAÇÃO (F-07)

O gate anterior bastava encontrar uma palavra afirmativa em qualquer posição, e errava nos dois sentidos: confirmava `"ok e qual o endereço"` e `"ok vou ver e te falo"` (o paciente estava adiando) e recusava `"blz"`, `"ss"`, `"ta bom"`, `"beleza"`, `"fechado"` — as respostas mais comuns do público-alvo.

A regra passa a ser: **todo token** da mensagem precisa ser afirmação, verbo de ação compatível ou ruído. Uma única palavra fora disso derruba a confirmação, porque significa que a mensagem diz outra coisa além de concordar. Além disso, um verbo de ação que **contradiz** a pendência (`"pode cancelar"` contra um agendamento preparado) nunca confirma.

Cada rejeição carrega um `reason` canônico (`hedge`, `not_affirmation_only`, `closing`, `contradicting_verb`, …), emitido em `ai_agent.confirmation.rejected` — o léxico passa a ser ajustável por dado, não por intuição.

### 3. O pré-filtro clínico ganha saída, sem afrouxar a blacklist (F-01)

A blacklist anti-SAMD **não muda** — falso negativo continua inaceitável, e `guards/adversarial-corpus.ts` + `semantic-guard.test.ts` travam exatamente quais das 50 mensagens do gate §11.12 passam hoje (6), de modo que uma 7ª quebra o build. O que muda é o que acontece **depois** da detecção:

- **Turno de cadastro é isento.** Em `collecting` / `awaiting_confirmation` o servidor responde sozinho e o LLM não é chamado — não há risco de orientação clínica. Sem a isenção, um `motivo` legítimo como "dor nas costas" era barrado, nunca gravado, e o cadastro travava para sempre.
- **Clínico + operacional vira resposta combinada.** "Quero marcar por causa de uma dor de dente" recebe a recusa clínica obrigatória **mais** o encaminhamento operacional (`OPERATIONAL_NUDGE`), ambos texto fixo do servidor. A jornada continua na mensagem seguinte em vez de morrer em silêncio.
- **O turno alimenta o contador de fallback.** É isto que finalmente implementa a promessa do §7 da ADR-022: N mensagens clínicas seguidas escalam para um humano.

### 4. A data relativa é resolvida pelo servidor (F-04)

`internal/relative-datetime.ts` traduz "hoje", "amanhã", "depois de amanhã", dia da semana, `dia N`, `dd/mm[/aaaa]`, horas humanas e períodos, ancorado no **fuso e no relógio da clínica**. O modelo interpreta linguagem; quem converte em instante é o servidor.

Precedência explícita: instante do servidor vence o `scheduled_at` do modelo; quando o servidor só tem uma janela e o modelo propôs algo **dentro** dela, o instante do modelo é aceito; hora nua 1–7 sem marcador AM/PM devolve **candidatos** e a tool pergunta, nunca chuta.

Isto substitui um regex de "amanhã às N" que vencia o modelo até quando a frase o negava e que lia "depois de amanhã" como "amanhã" — marcando no dia errado com confiança.

### 5. Disponibilidade tem piso por INSTANTE, opt-in (F-03)

`computeSlots` é cego ao relógio por construção (recebe DIAS). `getAvailableSlots` ganha `notBefore?: Date`, aplicado por `filterSlotsFrom`. **Opt-in de propósito:** Relatórios consulta janelas passadas para calcular taxa de ocupação, e filtrar lá zeraria `freeMinutes`.

O agente passa `notBefore = agora + AGENT_MIN_LEAD_MINUTES` (30). A política de antecedência é do AGENTE, não do Scheduling — a recepção humana legitimamente encaixa alguém para daqui a 10 minutos.

### 6. A chave de idempotência da execução inclui a linha pendente (F-05)

Era derivada só do conteúdo, para colapsar "preparar→confirmar duas vezes". Com TTL de 7 dias em `idempotency_keys`, isso fazia **episódios diferentes colidirem**: agendar → cancelar → pedir o mesmo horário devolvia a resposta cacheada (a consulta já cancelada) sem criar nada, e o agente anunciava sucesso de uma consulta inexistente.

A chave passa a incluir o `pendingActionId`. Nenhuma proteção se perde: retry do mesmo turno reusa a mesma linha; duplo SIM morre no consumo atômico; reentrega de webhook faz replay da row `out` sem chegar às tools; e o banco recusa duplo agendamento via `appointments_doctor_slot_uniq`, `appointments_patient_slot_uniq` e `appointments_no_overlap`.

### 7. Mensagens em rajada viram UM turno (F-08)

O paciente escreve como fala: "amanhã" / "de manhã" / "9". Cada fragmento virava um turno independente, processado em paralelo (`OUTBOX_PARALLELISM=5`) e sem ordem garantida. A FASE A passa a **reivindicar atomicamente** (`UPDATE … WHERE processed_at IS NULL RETURNING`) os inbounds recentes do mesmo contato e a costurá-los numa mensagem só.

A row `ai_messages` `'in'` é o **checkpoint do coalescing**: um retry relê dela o texto já costurado, em vez de reprocessar só o fragmento original. Os eventos de outbox das irmãs absorvidas caem no guard de `processed_at` e viram no-op.

### 8. O agente cala se um humano assumir durante o turno (F-09)

O status é lido no início e a chamada ao LLM leva segundos. A conversa é relida **antes da FASE D** — não depois — para que uma resposta não entregue nunca vire uma linha `'out'` que o painel exibiria como mensagem que o paciente não recebeu. Turnos que escalaram sozinhos são isentos: precisam entregar o próprio aviso.

### 9. Ajustes de superfície de tools

- `list_pending_payments` é declarada `effect: 'mutation'` — ela escala handoff, e como `read` escapava do teto de uma mutação por turno (F-10).
- `confirm_appointment` não confirma nada se existir pendência na conversa: o SIM pertence ao resumo que o paciente leu (F-11).
- `schedule_appointment` sai do catálogo exposto ao modelo. Aceitava ids arbitrários, não checava disponibilidade e resumia como "Agendar consulta para \<ISO cru\>". `prepare_appointment` é o único caminho de marcação (F-12). São 15 tools.

### 10. Campos de dado no prompt são sanitizados (F-06)

`{patient_line}` carrega o nome que o próprio paciente escolheu; `{pending_appointment_procedure}` carrega o texto dele. `sanitizePromptField` remove controle/chaves/marcação e trunca em 80 chars. A interpolação virou passada única, então um valor que contenha outro placeholder nunca é reinterpretado (F-19).

Isto **não** substitui as barreiras reais — identidade, confirmação e tenant são enforçados no servidor e não leem o prompt. Reduz a superfície de induzir o modelo a mentir ao paciente ou pular handoff.

## Consequences

- Orçamentos novos em `limits.ts` (congelados, como os demais): `AGENT_MIN_LEAD_MINUTES=30`, `COALESCE_MAX_MESSAGES=4`, `COALESCE_MAX_AGE_MS=90_000`.
- Migration `0074` — índice parcial em `inbound_messages_raw (clinic_id, from_number_hash, received_at) WHERE processed_at IS NULL`. Aditivo, não destrutivo.
- `PROMPT_VERSION` → `2026-08-14-v12`. `RAW_TEMPLATE` não mudou (`PROMPT_HASH` idêntico), mas o prompt renderizado sim; o bump separa turnos pré e pós-remediação numa auditoria.
- Métricas novas: `ai_agent.confirmation.rejected` (com `reason`), `ai_agent.turn.coalesced`, `ai_agent.turn.handoff_race_dropped`, `ai_agent.registration.handoff`.
- Mensagens clínicas passam a contar em `fallback_count`, que antes só media falha de provider. Painéis que leem esse campo como saúde do LLM verão tráfego clínico.
- Durante a coleta o LLM não roda em nenhuma hipótese. Se alguém adicionar depois um caminho "o modelo responde perguntas fora do formulário", a isenção do pré-filtro deixa de ser segura — há teste travando isso.

## Alternatives

- **Estreitar a blacklist clínica** para eliminar os falsos positivos (`estou com`, `to com`, `ansiedade` são as piores ofensoras). Rejeitado: troca um problema de produto por um risco de SAMD, e o gate §11.12 é o ativo mais caro desta camada.
- **Serializar o worker (`OUTBOX_PARALLELISM=1`)** em vez de coalescer. Resolveria a corrida com zero código, mas não junta os fragmentos — o paciente ainda receberia três respostas — e serializaria todos os tipos de evento.
- **Adiar o turno concorrente** com um claim em `ai_conversations`. Rejeitado: o backoff do outbox é de 30s, e responder 30s depois no WhatsApp é pior do que responder fora de ordem.
- **Manter a chave de idempotência por conteúdo** e detectar no cache-hit que a consulta está cancelada. Rejeitado: conserta o sintoma mantendo a colisão de episódios.
- **Confiar no modelo para as datas**, já que o prompt agora traz a data/hora da clínica. Rejeitado: a heurística existiu justamente porque o modelo errava, e um erro de dia é invisível para quem não relê o resumo.

## References

- `docs/audits/C12_AI_AGENT_AUDIT_2026-08-14.md` — auditoria completa (F-01…F-19)
- [ADR-022](022-ai-agent-foundation.md) §7 — semantic guard (emendado por esta ADR)
- [ADR-023](023-ai-agent-intents.md) — intents e tools da C12
- [ADR-047](047-ai-conversations-human-handoff.md) — handoff e painel de conversas
- `drizzle/migrations/0056_ai_pending_actions.sql` — schema das pending actions
- `docs/audits/C11_ADVERSARIAL_50.md` — gate §11.12 (50 mensagens, Gemini real)
