# Runbook — Validação C14 (Proactive Jobs)

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


Camada: C14 · Spec: [PlanoAção §14](../PlanoAção.md) · Reusa: C10 (messaging),
C5 (suppression/consent), outbox backoff (C4).

Mensagens proativas via template Meta: **lembrete D-1** (no-show), **dunning D+3/D+7**
(paciente inadimplente), **followup** (retorno pedido pelo médico). C14 é **transporte**:
a regra de "quem recebe" mora no contexto-fonte; a resposta (SIM/NÃO/REMARCAR) é do C11.

## Pré-requisitos

- Migration `0027_heavy_carmella_unuscione.sql` aplicada (`pnpm db:migrate:dev`).
- `CRON_SECRET` no `.env.local` (já existe desde C4).
- **Para o envio real** (não para enqueue/guard/policy): número WhatsApp conectado
  na clínica (C10 `wa:connect`) + `META_TEMPLATE_*_ID` setados (ver §Pendências).

## Bateria automatizada (referência 2026-06-18 — tudo verde)

| Comando | O que prova | Esperado |
|---|---|---|
| `pnpm test` | tz (dias-calendário), policy (suppression/consent), processor (T1/T2/T5/T6) | **388 passed** |
| `pnpm typecheck` / `pnpm lint` | tipos + boundaries + dbAdmin allowlist | verde |
| `pnpm arch:db-check` | os 3 arquivos cross-tenant (reminder/dunning-candidates, repository) na allowlist | 0 findings |
| `pnpm check:registry:strict` | handler followup ativo; `clinical.prontuario.signed` saiu da allowlist | catalog(44) ⇔ registry(11) |
| `pnpm check:migrations` | 0027 sem destrutivo | OK |

Cobertura §14.6 automatizada: **T1** appointment ativo → job → cron → enviado;
**T2** suppression/sem-opt-in → cancelled(reason); **T5** dunning pago → cancelled
(`already_paid`); **T6** falha Meta → retry/backoff → failed após MAX_ATTEMPTS.
**T3/T4** (SIM/REMARCAR) NÃO são do C14 — são do C11 (inbound webhook → tools
confirm/reschedule), inalterado; validar pela bateria do C11/C12.

## Validação MANUAL (contra qoro-dev — cobre o que o vitest não cobre)

O vitest mocka I/O. O **SQL cru** (CTE `claimDue` com `FOR UPDATE SKIP LOCKED` +
janela `AT TIME ZONE`, read-models cross-tenant) e as **policies RLS** só se provam
contra Postgres real.

### 1. Aplicar migration + smoke automatizado (NÃO precisa de Meta)
```bash
pnpm db:migrate:dev   # aplica 0027
pnpm smoke:c14        # semeia, exercita e limpa (CASCADE) — 8 checks
```
`smoke:c14` cobre, contra o dev DB: getProactiveContact (decrypt + consent),
suppression, reminder enqueue + DEDUP, dunning D+3/D+7 por `due_date`, guard
"pagou→não envia" (T5 nível candidato), `claimDue` (CTE/SKIP LOCKED + janela 8-20h),
followup via worker e RLS A↔B. Esperado: `8 OK · 0 FAIL`.
Env necessário: `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `CRYPTO_MASTER_KEY_V1`,
`CRYPTO_LOOKUP_SALT` (mesmos do dev; ver §Credenciais Meta abaixo p/ o resto).

> Nota: `smoke:c14` roda `enqueueRemindersDue/DunningDue` que são cross-tenant —
> em dev pode materializar jobs de OUTRAS clínicas de teste com consulta amanhã /
> recebível vencido. Inócuo em qoro-dev; o cleanup remove só as clínicas do smoke.

### 2. (Opcional) Disparar os crons HTTP manualmente
```bash
export OUTBOX_CRON_ALLOW_NON_VERCEL=true
for c in proactive-reminders proactive-dunning proactive-followup; do
  curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/$c | jq
done
psql "$DATABASE_URL" -c "SELECT type,status,attempts,failed_reason,scheduled_for FROM ai_proactive_jobs ORDER BY created_at DESC LIMIT 20;"
```
Sem número/template configurado, o envio falha `number_not_connected` /
`template_not_configured` (esperado até o §Pendências) — o resto da pipeline roda.

### 3. Envio real + resposta (só com Meta conectado + templates aprovados)
Pré: template APROVADO na Meta + `META_TEMPLATE_*_ID` no env + número conectado
(`pnpm wa:connect --clinic <uuid> --phone <e164> --meta-phone-id <id> --token <tok>`).

**3a. Teste isolado do template (mais rápido)** — reusa o `buildProactiveTemplate` real:
```bash
pnpm wa:send-template --clinic <uuid> --to <SEU_WHATSAPP_E164> --type reminder
# repetir com --type dunning e --type followup
```
Esperado: `status=accepted` + a mensagem chega no seu WhatsApp. `status=failed` →
ver `providerMessageId`/log (template não aprovado, nome errado no env, número não
conectado, ou recipient não autorizado se usar o número de TESTE da Meta).

**3b. Pipeline completa + resposta (E2E):**
1. Reminder chega no WhatsApp do paciente (template `confirmation_reminder`).
2. Paciente responde **SIM** → C11 chama `confirm_appointment` (consulta → `confirmado`).
3. Paciente responde **REMARCAR** → C11 entra no fluxo de reschedule.
4. Conferir o par job↔envio: `outbound_messages.idempotency_key = ai_proactive_jobs.id`
   (chave estável → at-most-once no Meta).

## Pendências ANTES de prod (checklist go-live)

- [ ] Aplicar `0027` em prod: `pnpm db:migrate:prod` (dump automático antes).
- [ ] `pnpm db:generate` não gera diff novo (snapshot drizzle sincronizado).
- [ ] **Cadastrar + aprovar 3 templates no Meta Business Manager** (variáveis na ordem):
      `confirmation_reminder` `{nome}{horario}{dr_nome}` ·
      `dunning_friendly` `{nome}{data}{valor}` · `followup_return` `{nome}{dr_nome}`.
- [ ] Setar env de PROD: `META_TEMPLATE_CONFIRMATION_REMINDER_ID`,
      `META_TEMPLATE_DUNNING_FRIENDLY_ID`, `META_TEMPLATE_FOLLOWUP_RETURN_ID`,
      `META_TEMPLATE_LANG=pt_BR` (valor = NOME aprovado, não ID opaco).
- [ ] Vercel **Pro** (agora são 11 crons; os 3 `proactive-*` aparecem no dashboard,
      `*/15 11-23 * * *` = janela 8-20h BRT).
- [ ] Cada clínica ativa com número WhatsApp conectado (C10) — sem ele, jobs falham
      `number_not_connected`.
- [ ] (LGPD) Pacientes que receberão **dunning** têm `cobranca_whatsapp=true`
      (reminder/followup são transacionais, não exigem o flag).
- [ ] Gate §14.7: validar 1 ciclo D-1 (lembrete→resposta→confirmação) com 5 pacientes reais.

## Operação às 3h da manhã

- **"lembrete não chegou":** `SELECT * FROM ai_proactive_jobs WHERE status='pending'
  AND scheduled_for < now();` (job preso) ou `status='failed'` + `failed_reason`.
- **Meta rejeitou template:** revisar texto + resubmeter; trocar o nome no ENV. Jobs
  em curso falham `template_not_configured`/`meta_failed` e retêm via backoff.
- **Spam complaint:** adicionar paciente em `suppression_list` (canal whatsapp) →
  próximos jobs viram `cancelled` (`suppressed`) antes do envio.
- **Retry:** `attempts` + `scheduled_for` (backoff 30s→5m→30m→6h, MAX 5, igual outbox);
  após o limite → `failed` (replay manual: `UPDATE ... SET status='pending', attempts=0`).

## Débitos conhecidos (não bloqueiam go-live)
- Reconciliação delivery-callback (`unknown→sent`) — C15/C16.
- Trim mensal de `ai_proactive_jobs` — C16.
- `enqueue` `LIMIT 500/scan` sem anti-join (ok até ~200 jobs/clínica/dia; §14.13).
- Sem `smoke-c14.ts` automatizado — esta validação manual cobre o gap de SQL/RLS.
