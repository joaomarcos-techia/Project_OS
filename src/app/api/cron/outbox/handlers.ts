/**
 * Outbox handler boot file.
 *
 * Side-effect imports of every consumer module across bounded contexts.
 * Each imported module calls `registerHandler(...)` at top level, populating
 * the handler registry that the worker consults.
 *
 * Why this lives at the cron route layer (and not in `src/lib/outbox/`):
 *   ADR-001 forbids `lib → context` imports. The cron route is in the `app`
 *   layer where importing context internals is permitted, so the side-effect
 *   wiring lives here. Producer code (publishEvent) does NOT import this file
 *   — it only consults the catalog (schema), which is populated by the regular
 *   `events.ts` files re-exported via the schema barrel.
 *
 * C4 ships with NO handlers registered — no consumer exists yet. C5+ adds
 * imports here as bounded contexts grow:
 *
 *   import '@/contexts/financial/internal/handlers/appointment-completed';
 *   import '@/contexts/ai-agent/internal/handlers/patient-created';
 *   import '@/contexts/identity/internal/handlers/clinic-suspended';
 *
 * Adding an import here is the ONLY action required to activate a handler
 * in production — drove deploy-ordering safety in producer code via the
 * separate catalog/registry split (see catalog.ts).
 */

// C5 — Patient LGPD handlers (self-consumed events).
import '@/contexts/patient/internal/handlers/lgpd-export-requested';
import '@/contexts/patient/internal/handlers/lgpd-delete-requested';

// C6 — Scheduling: cancela agendamentos futuros quando paciente é removido
// (reage a patient.core.deleted + patient.lgpd.delete_requested).
import '@/contexts/scheduling/internal/handlers/patient-deleted';

// C7 — Clinical: appointment.started → cria prontuário rascunho (idempotente).
import '@/contexts/clinical/internal/handlers/appointment-started';

// C9 — Financial: appointment.completed → cria lançamento a receber (substitui
// o placeholder temp do C6). Idempotente via UNIQUE(appointment_id).
import '@/contexts/financial/internal/handlers/appointment-completed';
// C9 — Scheduling reage aos eventos de Financial para escrever a própria coluna
// appointments.faturamento_pendente (ownership físico; ver ADR-014 R11/M12).
import '@/contexts/scheduling/internal/handlers/financial-faturamento-pendente';
import '@/contexts/scheduling/internal/handlers/financial-lancamento-created';

// C11 — AI Agent: messaging.inbound.received → turno de conversa (saga
// multi-fase, LLM fora de TX — ADR-022). Idempotente via eventId checkpoints.
import '@/contexts/ai-agent/internal/handlers/inbound-received';

// C13 — Billing: metering de uso (idempotente via usage_counter_ledger).
// scheduling.appointment.created → +1 agendamentos; ai_agent.conversation.completed
// → +1 conversas_ia (outcome='replied'). NUNCA bloqueiam (ADR-024) — só contam.
import '@/contexts/billing/internal/handlers/appointment-created';
import '@/contexts/billing/internal/handlers/conversation-completed';

// ADR-047 — AI Agent: resposta manual do painel → envia ao WhatsApp fora da TX
// (a Server Action persistiu a mensagem + publicou o evento atomicamente).
import '@/contexts/ai-agent/internal/handlers/manual-reply-requested';

// Coexistência (0107) — AI Agent: a recepção respondeu pelo app WhatsApp
// Business do celular → a mensagem entra na conversa e a IA pausa (handoff).
import '@/contexts/ai-agent/internal/handlers/business-app-echo';

// C14 — Proactive Jobs: prontuário assinado com needs_return → agenda followup.
// (reminder/dunning NÃO são handlers — são cron-scan dos read-models das origens.)
import '@/contexts/ai-agent/proactive-jobs/internal/handlers/prontuario-signed';

// WAIT-001 — scheduling.waitlist.offered → mensagem de oferta da vaga. Sem este
// import o evento continuava terminando como `skipped` e a UI seguia dizendo
// "Oferta enviada" sem que nada tivesse sido enviado.
import '@/contexts/ai-agent/proactive-jobs/internal/handlers/waitlist-offered';

// ADR-049 1.3 — Payments criou a cobrança do sinal → a AGENDA segura a vaga.
// O Payments não escreve `appointments` (regra R3); a projeção mora no Scheduling.
import '@/contexts/scheduling/internal/handlers/patient-charge-created';

// ADR-049 1.4 — sinal PAGO → a agenda confirma o agendamento (agendado→confirmado,
// pela máquina congelada). Pagamento sobre agendamento já cancelado/expirado NÃO
// ressuscita a vaga: registra e deixa para o estorno da 1.5.
import '@/contexts/scheduling/internal/handlers/patient-charge-paid';

// ADR-049 1.5 — ramos A e C. DETACHED nos dois: o corpo fala com o Asaas, e
// chamada externa dentro da TX do worker prende conexão do pool.
//   faltou     → sinal pago vira taxa retida; sinal não pago tem o LINK MORTO
//                (senão a falta ainda gera pagamento dias depois);
//   cancelado  → dentro da janela devolve; fora dela retém; sem pagamento, mata
//                o link — inclusive o `deposit_expired`, cuja cobrança ficava
//                `pending` para sempre porque a varredura só mexia na agenda.
// `no_show` já possui a consequência financeira acima e a ADR-057 acrescenta a
// recuperação C14. O registry é 1:1, então o app compõe as duas fases num único
// handler detached, preservando TX curta antes da chamada externa ao Asaas.
import './appointment-no-show-handler';
import '@/contexts/payments/internal/handlers/appointment-cancelled';
// Agendamento pela IA confirmado -> tenta criar o sinal sem aguardar o scan de 15 min.
import '@/contexts/payments/internal/handlers/appointment-deposit-requested';
// ADR-049 1.5 — desfecho da cobrança projetado na agenda (R3: o Payments publica,
// a agenda escreve a própria coluna).
import '@/contexts/scheduling/internal/handlers/patient-charge-closed';

// ADR-049 1.6a — link do sinal pronto → entrega ao paciente pela fila C14.
// A IA segue read-only em cobrança: o SISTEMA gera e a fila envia por template
// aprovado; não há LLM em nenhum ponto deste caminho.
import '@/contexts/ai-agent/proactive-jobs/internal/handlers/patient-charge-link-ready';

// ADR-051 1.5b.1 — o dinheiro do paciente contado no FINANCIAL, que e a fonte da
// verdade financeira. Eventos PROPRIOS do credito (`patient_credit.*`), e nao os
// da cobranca: `patient_charge.paid`/`.closed` ja tem dono no Scheduling, e os
// dois pares significam coisas diferentes para dominios diferentes.
import '@/contexts/financial/internal/handlers/patient-credit-granted';
import '@/contexts/financial/internal/handlers/patient-payment-economics-reconciled';
import '@/contexts/financial/internal/handlers/patient-payment-economics-corrected';
import '@/contexts/financial/internal/handlers/patient-credit-released';

// D50 — Financial detecta excedente; Payments executa o estorno fora da TX do worker.
import '@/contexts/payments/internal/handlers/excess-refund-requested';
import '@/contexts/financial/internal/handlers/excess-refund-confirmed';
import '@/contexts/financial/internal/handlers/patient-payment-risk-changed';

export {};
