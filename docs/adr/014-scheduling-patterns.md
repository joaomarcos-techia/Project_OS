# ADR-014 — Scheduling Core (C6): contratos congelados

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: C6 (Scheduling Core)
- Refs: VisãoGeral §4.4, PlanoAção §CAMADA 6, ADR-007 (RLS), ADR-011 (outbox/audit/idempotency)

## Context

C6 emite `scheduling.appointment.completed`, o contrato oficial com Financial (C9)
— bug aqui = dinheiro escapando. A revisão arquitetural (3 rodadas com o founder)
expôs conflitos entre os dois documentos-fonte e gaps escondidos. Este ADR congela
as decisões para que C7/C9/C11/C12 construam sobre terreno estável.

## Decision

**R1 — UNIQUE de duplo-agendamento.** `UNIQUE(doctor_id, scheduled_at) WHERE
slot_occupies_instant` (predicado via coluna gerada). PlanoAção vence VisãoGeral
(que incluía `unit_id`): um médico não está em duas unidades no mesmo instante.

**R2/M1 — Anti-overlap real.** Além do UNIQUE, `EXCLUDE USING gist` sobre
`tstzrange(scheduled_at, +duration)` por médico (btree_gist), isento de walk-ins e
estados terminais via `slot_blocks_overlap`. O UNIQUE só pega colisão exata; o
EXCLUDE pega sobreposição de faixa.

**R3 — Evento de paciente removido.** O nome real é `patient.core.deleted` (NÃO
`patient.deleted`). O outbox é **one-handler-per-event**; o handler LGPD do próprio
Patient já consome `patient.lgpd.delete_requested`. Logo: (a) `requestLgpdDelete`
passou a emitir TAMBÉM `patient.core.deleted` (sinal canônico de remoção); (b)
Scheduling registra um único handler para `patient.core.deleted`.

**R4 — Sem tabela `slots`.** Slots são computados pelo resolver puro
(availability − appointments − holidays); a `slots` da VisãoGeral é futura.

**R5 — clinic_id nos logs.** `procedure_history` e `appointment_state_log` têm
`clinic_id` + RLS (REGRA 1, sem exceção) — o spec os listava sem.

**R6 — `em_atendimento` não cancelável.** A state machine só permite
`em_atendimento → atendido`. O handler patient-deleted pula appointments nesse
estado (metric), nunca tenta cancelá-los.

**R7 — 23P01 ≠ 23505.** `isExclusionViolation` mapeia o EXCLUDE; ambos os códigos
viram `SchedulingConflictError("horário ocupado")`.

**R8/M4 — Snapshot imutável por trigger.** `BEFORE UPDATE` barra mudança de
`snapshot_*` e `rescheduled_from_appointment_id`. crm/especialidade (forward-compat,
NULL hoje): backfill **único** NULL→valor permitido, congela depois.

**R10/M7 — Timezone.** `clinics.timezone` (default `America/Sao_Paulo`); conversão
wall-clock↔UTC via Intl (DST-correct) na fronteira do resolver; `computeSlots` puro.
**CONGELADO: 1 clínica = 1 timezone** até existir override por unidade
(`clinic_units.timezone` é evolução futura não-quebra).

**R11/M12 — Ownership de `faturamento_pendente`.** Coluna em `appointments`
(default false). Scheduling NUNCA a escreve após criação; **Financial (C9) é o owner
semântico exclusivo**.

**R12/M15 — Overlap interno de disponibilidade.** `EXCLUDE` em `doctor_availability`
(omitindo `unit_id`) impede janelas sobrepostas do mesmo médico → sem slots fantasma.

**R13/M16 — Lock em transições.** Toda action de transição faz `SELECT … FOR UPDATE`
na row antes de `assertTransition` (serializa confirmar×cancelar concorrentes).

**M3 — Reschedule preserva preço.** `rescheduleAppointment` = cancel + create na
mesma TX; o novo carrega snapshot_* e valor do original. `rescheduled_from_appointment_id`
(self-FK + CHECK `<> id` + imutável) reconstrói a cadeia A→B→C→D.

**Walk-in (Estratégia A).** `created_via='walkin'` + `scheduled_at=now()` (microssegundos
→ nunca colide na UNIQUE; isento do EXCLUDE). Estratégia B (`appointment_type`) é
anti-hidra-proibida; C (slot virtual) inexiste sem tabela slots. **Bypass intencional
e congelado**: NÃO há limite de walk-ins por médico no MVP (paciente urgente não é
barrado por constraint); rate-limit é feature futura.

**Permissões granulares.** `manage:procedures` (owner, gestor) e `manage:availability`
(owner, gestor, doctor), seed em 0016. Appointments usam `edit:agenda`/`view:agenda`.

**Procedure lifecycle.** MVP usa `ativo boolean`. Evolução futura
(`draft/active/deprecated/archived`) é migração `boolean→enum` não-quebra — documentada,
não implementada (anti-hidra).

**M20 — correlation_id.** Aditivo em `outbox` + `audit_events` + `appointment_state_log`,
threadado por `publishEvent`/`logAudit`/`buildRequestContext`. Propagação consumer-side
(worker→handler) entra quando C7/C9 precisarem.

## Consequences
- (+) Integridade de duplo-agendamento e overlap garantida no banco (fail-closed).
- (+) Snapshot/lineage à prova de UPDATE acidental; auditoria forense rica (actor/source/correlation).
- (+) Slot resolver correto em timezone, testável sem DB.
- (−) FKs cross-context (`doctor_id`→profiles, `patient_id`→patients, `unit_id`→clinic_units)
  vivem só na SQL da migration (Drizzle declara `uuid()` puro) — divergência schema↔migration
  conhecida e aceita (boundaries limpas).
- (−) `requestLgpdDelete` emite dois eventos; o acoplamento "remoção = core.deleted" fica explícito.
- (−) Migração de propriedade de `faturamento_pendente` para Financial em C9 (custo conhecido).
