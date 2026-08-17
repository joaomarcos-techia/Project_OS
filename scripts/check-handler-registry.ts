/**
 * CI gate (HIGH-09): garante que TODO event_type registrado no CATALOG tem
 * um handler registrado no REGISTRY — OU está na allowlist explícita de
 * "producer ahead of consumer" (F-14, auditoria forense 2026-06-10).
 *
 * Cenário que isto previne:
 *   Dev em C8 adiciona `registerEventSchema('clinical.prescription.signed', ...)`
 *   em `src/contexts/clinical/events.ts` (importado pelo barrel — catalog
 *   populado em todo lugar). Esquece de adicionar
 *   `import '@/contexts/clinical/internal/handlers/prescription-signed';` no
 *   boot file `src/app/api/cron/outbox/handlers.ts` (registry vazio para esse
 *   type). Em produção, Server Actions publicam o evento; worker pega; o evento
 *   vira 'skipped' silenciosamente (semântica F-03) sem ninguém notar.
 *
 * F-14: o `--strict` original falhava para TODOS os eventos sem handler — mas
 * "evento sem handler" é um estado TERMINAL LEGÍTIMO (status `skipped`,
 * worker.ts) para eventos cujo consumidor chega em camada futura (C11/C14...).
 * O modo strict era incompatível com a própria semântica do worker e por isso
 * nunca entrou no CI. Agora: eventos na allowlist PRODUCER_AHEAD são aceitos
 * SEM handler; qualquer evento fora dela sem handler é fatal em strict; e uma
 * entrada da allowlist que GANHOU handler vira erro (entrada obsoleta — remova
 * da allowlist no mesmo PR que ativa o handler).
 *
 * Exit code:
 *   0 = coerente (handlers ⊆ catalog; sem-handler ⊆ allowlist; allowlist limpa)
 *   1 = incoerência (detalhada no stderr)
 *
 * Uso: `pnpm check:registry` (warn-only fora de strict) e
 *      `pnpm check:registry:strict` (CI — fatal).
 */
import './_env';

// IMPORTANTE: importar nesta ordem replicará o que o cron route faz em produção.
import '@/lib/db/schema'; // populates catalog via context events.ts barrel
import '@/app/api/cron/outbox/handlers'; // populates registry via boot file

import { listEventTypes } from '@/lib/outbox/catalog';
import { listRegisteredHandlers } from '@/lib/outbox/registry';

const strict = process.argv.includes('--strict') || process.env.NODE_ENV === 'production';

/**
 * F-14 — allowlist "producer ahead of consumer": eventos publicados HOJE cujo
 * consumidor pertence a uma camada FUTURA. O worker os marca `skipped`
 * (terminal, sem retry/circuit — F-03). Ao ativar um handler para um destes,
 * REMOVA a entrada daqui no mesmo PR (o gate falha se esquecer).
 */
const PRODUCER_AHEAD = new Set<string>([
  // C10 — callback de entrega atualiza a mensagem e emite métrica; não há
  // consumidor assíncrono enquanto não existir projeção de status.
  'messaging.outbound.status_updated',
  // C11/C14/C15 — consumidores de ciclo de vida do paciente (IA, jobs proativos)
  'patient.core.created',
  'patient.core.updated',
  'patient.core.merged',
  'patient.relationship.linked',
  'patient.relationship.unlinked',
  'patient.consent.granted',
  'patient.consent.revoked',
  'patient.suppression.added',
  // C14 — lembretes/notificações de agenda
  // (scheduling.appointment.created saiu daqui: C13 Billing ativou handler de metering)
  'scheduling.appointment.confirmed',
  'scheduling.appointment.checked_in',
  'scheduling.appointment.cancelled',
  'scheduling.appointment.no_show',
  'scheduling.appointment.rescheduled',
  'scheduling.appointment.corrected',
  'scheduling.doctor_absence.created',
  // BILLING-002 — emitido quando o GET autoritativo confirma que a cobrança
  // sumiu do Asaas. Fecha a invoice na própria transação; não há projeção
  // assíncrona a alimentar.
  'billing.invoice.cancelled',
  'scheduling.recurrence.created',
  'scheduling.recurrence.cancelled',
  'scheduling.import.completed',
  // C11+ — projeções clínicas/relatórios
  'clinical.prontuario.created',
  // clinical.prontuario.signed saiu daqui: C14 ativou handler de followup (F-14).
  'clinical.prescription.created',
  'clinical.document.generated',
  // C13/C14 — financeiro downstream (recibos, cobrança, dashboards)
  'financial.lancamento.paid',
  'financial.lancamento.cancelled',
  'financial.lancamento.estornado',
  // C11 ATIVOU o handler de messaging.inbound.received (removido daqui no
  // mesmo PR — F-14). (ai_agent.conversation.completed saiu daqui: C13 Billing
  // ativou handler de metering de cota de IA.)
  // C13 — Billing emite o ciclo de vida; consumidores chegam em camadas futuras:
  // C14 (proactive jobs) consome dunning_advanced/payment_failed → WhatsApp/email;
  // Identity consome subscription.activated → cria owner (seam ADR-025 F2, ativado
  // no onboarding); demais são timeline/UI/NF/external (sem consumidor de worker).
  // Ao ativar qualquer handler destes, REMOVA a entrada no mesmo PR (F-14).
  'billing.customer.created',
  'billing.customer.portal_requested',
  'billing.subscription.created',
  'billing.subscription.activated',
  'billing.subscription.changed',
  'billing.subscription.cancelled',
  'billing.invoice.generated',
  'billing.invoice.paid',
  'billing.invoice.overdue',
  'billing.invoice.refunded',
  'billing.payment.failed',
  'billing.trial.started',
  'billing.trial.expired',
  'billing.trial.converted',
  'billing.clinic.suspended',
  'billing.clinic.reactivated',
  'billing.clinic.dunning_advanced',
]);

const inCatalog = new Set(listEventTypes());
const inRegistry = new Set(listRegisteredHandlers());

const handlerMissingCatalog = [...inRegistry].filter((t) => !inCatalog.has(t));
const missingHandler = [...inCatalog].filter((t) => !inRegistry.has(t));
const unexpectedMissingHandler = missingHandler.filter((t) => !PRODUCER_AHEAD.has(t));
const allowlistedMissingHandler = missingHandler.filter((t) => PRODUCER_AHEAD.has(t));
const staleAllowlist = [...PRODUCER_AHEAD].filter((t) => inRegistry.has(t));
const unknownAllowlist = [...PRODUCER_AHEAD].filter((t) => !inCatalog.has(t));

let failed = 0;

if (handlerMissingCatalog.length > 0) {
  // SEMPRE fatal: handler registrado para event_type sem schema → publishEvent
  // recusaria publicar; o handler nunca vai disparar.
  console.error(`[FAIL] ${handlerMissingCatalog.length} handler(s) sem schema no catalog:`);
  for (const t of handlerMissingCatalog) console.error(`  - ${t}`);
  failed++;
}

if (staleAllowlist.length > 0) {
  // SEMPRE fatal: entrada da allowlist que já tem handler = allowlist obsoleta.
  console.error(
    `[FAIL] ${staleAllowlist.length} entrada(s) da allowlist PRODUCER_AHEAD já possuem handler (remova-as):`,
  );
  for (const t of staleAllowlist) console.error(`  - ${t}`);
  failed++;
}

if (unknownAllowlist.length > 0) {
  // SEMPRE fatal: allowlist referencia evento que não existe no catalog (typo
  // ou evento removido) — fail-closed contra allowlist apodrecida.
  console.error(
    `[FAIL] ${unknownAllowlist.length} entrada(s) da allowlist não existem no catalog:`,
  );
  for (const t of unknownAllowlist) console.error(`  - ${t}`);
  failed++;
}

if (unexpectedMissingHandler.length > 0) {
  // Fora da allowlist: em DEV (sem --strict) é warning; em strict/prod é fatal.
  const label = strict ? '[FAIL]' : '[WARN]';
  console.error(
    `${label} ${unexpectedMissingHandler.length} event_type(s) com schema mas SEM handler e FORA da allowlist producer-ahead:`,
  );
  for (const t of unexpectedMissingHandler) console.error(`  - ${t}`);
  if (strict) failed++;
}

if (failed === 0) {
  console.log(
    `[OK] catalog (${inCatalog.size}) ⇔ registry (${inRegistry.size}) coherent; ` +
      `${allowlistedMissingHandler.length} producer-ahead allowlisted`,
  );
}

process.exit(failed === 0 ? 0 : 1);
