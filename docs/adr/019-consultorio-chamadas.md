# ADR-019 — Consultório (C8): orquestração + tabela `chamadas` + Realtime

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

- Status: accepted
- Camada: C8 (Consultório UI)

> **Update (2026-06-03): TV `/chamadas` descopada.** Durante a validação do C8 o
> founder removeu a TV ("inútil no momento"). Saíram do produto: a rota `/chamadas`,
> o botão "Chamar de novo", a gravação de chamada (`recordChamada` deixou de ser
> chamada) e a subscription Realtime de `chamadas` (o board escuta só `appointments`).
> `recordChamada`/`listChamadas` saíram do código e a tabela `chamadas` foi
> **removida do banco** pela migration `0019_drop_chamadas` (`DROP TABLE chamadas
> CASCADE`) — o caminho "zero rastro" foi tomado (0018 permanece imutável apenas no
> histórico de migrations). Logo: D1 (onde `chamadas` vivia) e o débito da TV-com-login
> em "Consequences" valem como **registro histórico**, não como estado atual.
> D2/D3/D4/D5 seguem vigentes (o board e seu Realtime operam só sobre `appointments`).
- Refs: VisãoGeral §4.5 (Módulo Consultório), ADR-014 (Scheduling C6), ADR-017
  (retenção de prontuário), ADR-018 (UI foundation), ADR-007 (RLS), ADR-011
  (outbox/audit/idempotency)

## Context

C8 entrega `/consultorio` (cockpit do médico) e `/chamadas` (TV passiva). Todo o
backend já existe e está congelado (C6 state machine + actions com lock; C7
prontuário com autosave/assinatura). Surgiram três decisões que não estavam
cobertas pelos contratos anteriores e merecem registro.

## Decision

**D1 — `chamadas` vive no contexto Clinical.** O "Módulo Consultório" é
documentado sob Clinical (VisãoGeral §4.5). `chamadas` é uma **projeção de display
append-only** (alimenta a TV e o board), NÃO uma state machine nem um fluxo de
appointment novo (proibições do C8 respeitadas). Não foi colocada em Scheduling
porque (a) C6 está fechada/congelada e (b) "chamar de novo" (rechamada) não muda
estado de appointment — logo não é uma transição de Scheduling. Coluna `snapshot_*`
congela o que a TV mostra (o `snapshot_doctor_nome` funciona como "SALA", já que
não há modelo de salas no MVP). Append-only: sem `updated_at`, sem trigger.

**D2 — Estado visual nunca é fonte de verdade.** Toda transição passa pelas
actions de C6 (`SELECT … FOR UPDATE` + `assertTransition` + outbox na mesma TX).
As Server Actions de C8 (`callNextPatient`, `markAbsent`, `completeConsulta`, …)
são **orquestração fina** — zero regra de negócio. Concorrência (dois médicos,
mesmo appointment) resolve no banco: o segundo recebe `InvalidTransitionError` e
o board reflete o vencedor via Realtime. "Apenas um vence" é garantia de C6.

**D3 — Prontuário garantido de forma síncrona no `callNextPatient`.** O worker de
outbox roda ~1×/dia no Vercel Hobby; depender do handler async
`scheduling.appointment.started → prontuário rascunho` deixaria o prontuário
inline sem aparecer. Então `callNextPatient` e `loadAtendimento` criam o rascunho
sob demanda via `createProntuario` (idempotente no `appointment_id`); o handler
async vira no-op (`onConflictDoNothing`). Atendente (sem `create:prontuario`) não
cria — o draft nasce quando o médico abre o painel.

**D4 — Realtime do Supabase com RLS por JWT + fallback de polling.** `appointments`
e `chamadas` entram na publication `supabase_realtime` (REPLICA IDENTITY FULL p/
o filtro `clinic_id` em UPDATE). A **RLS é o gate de isolamento** (subscriber
autenticado só recebe linhas do seu tenant via `current_clinic_id()`); o `filter`
é relevância/perf. Se o canal cair, entra polling com backoff 5→10→15→30s; ao
reconectar, desliga e refaz o fetch. Transições de Realtime/polling são logadas
(observabilidade C8).

**D5 — Finalizadas = somente leitura.** Reabrir uma consulta atendida carrega o
prontuário assinado read-only no painel central. Correção pós-assinatura
(`editSignedProntuario` / versão / auditoria) é fluxo de C10+, fora de C8.

## Consequences
- (+) Scheduling (C6) permanece intocado; o board é pura apresentação +
  orquestração sobre contratos congelados.
- (+) Isolamento multi-tenant uniforme: a mesma RLS (`defaultTenantPolicy`) vale
  para leitura, escrita e Realtime.
- (+) Sistema funcional sem Realtime (polling) — degradação graciosa.
- (−) **TV depende de login** (`/chamadas` exige sessão p/ herdar RLS): a sessão
  pode expirar na máquina da recepção. Débito conhecido. Evolução planejada: rota
  pública read-only com token assinado por clínica (`/chamadas/[slug]?k=<token>`),
  fora do escopo de C8.
- (−) "SALA" = nome do médico (sem modelo de salas). Evolução: rótulo por profile.
- (−) `chamadas` é conceitualmente "consultório", não estritamente clínico — mora
  em Clinical por pragmatismo (D1); registrado aqui para não virar mistério.

## Alternatives
- **`chamadas` em Scheduling:** rejeitado — C6 congelada e rechamada não é
  transição de estado.
- **Derivar a TV de `appointment_state_log` (sem tabela nova):** rejeitado — não
  captura rechamada (mesmo estado) e o contrato C8 pede a tabela `chamadas`.
- **Depender do handler async para criar o prontuário:** rejeitado — cron 1×/dia
  no Hobby; o inline não abriria a tempo (D3).
- **WebSocket próprio:** proibido pelo escopo C8; usamos Supabase Realtime.

## References
- `src/contexts/clinical/schema.ts` (`chamadas`), `drizzle/migrations/0018_consultorio_chamadas.sql`
- `src/app/(app)/(shell)/consultorio/*`, `src/app/(app)/chamadas/*`
- `src/lib/realtime/use-consultorio-realtime.ts`
- `docs/runbooks/c8-validation.md`
