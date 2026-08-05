import { describe, expect, it } from 'vitest';

import { annualRefundCents, annualSavingsCents } from './annual-prepay';
import { accessForStage, daysOverdue, dunningStageForDays, evaluateDunning } from './dunning';
import { accessModeToClinicStatus, isWriteBlocked } from './access';
import { proRataCents, toCents, toReais, toReaisString } from './money';
import { enforce, ledgerKeyFor, metricForQuotaType } from './quota-policy';
import { canTransitionBilling, canTransitionInvoice } from './state-machine';

describe('money (centavos, sem float)', () => {
  it('parseia string numeric do Postgres exatamente', () => {
    expect(toCents('149.00')).toBe(14900);
    expect(toCents('1519.80')).toBe(151980);
    expect(toCents('0.05')).toBe(5);
    expect(toCents('699')).toBe(69900);
  });
  it('parseia number', () => {
    expect(toCents(149)).toBe(14900);
    expect(toCents(1519.8)).toBe(151980);
  });
  it('ida e volta', () => {
    expect(toReais(14900)).toBe(149);
    expect(toReaisString(151980)).toBe('1519.80');
    expect(toReaisString(5)).toBe('0.05');
  });
  it('proRata é round-half-up e clampado', () => {
    expect(proRataCents(10000, 1, 3)).toBe(3333);
    expect(proRataCents(10000, 2, 3)).toBe(6667);
    expect(proRataCents(10000, 5, 3)).toBe(10000); // clamp
    expect(proRataCents(10000, -1, 3)).toBe(0); // clamp
    expect(proRataCents(10000, 1, 0)).toBe(0); // den 0
  });
});

describe('annual prepay refund (determinístico)', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2027-01-01T00:00:00Z'); // 365 dias
  it('full term restante = total', () => {
    expect(annualRefundCents(151980, start, end, start)).toBe(151980);
  });
  it('nada restante = 0', () => {
    expect(annualRefundCents(151980, start, end, end)).toBe(0);
  });
  it('metade do período ≈ metade', () => {
    const mid = new Date('2026-07-02T00:00:00Z'); // ~182 dias usados
    const refund = annualRefundCents(151980, start, end, mid);
    expect(refund).toBeGreaterThan(75000);
    expect(refund).toBeLessThan(77000);
  });
  it('cancelamento após o fim não gera refund negativo', () => {
    const after = new Date('2027-06-01T00:00:00Z');
    expect(annualRefundCents(151980, start, end, after)).toBe(0);
  });
  it('economia anual nunca negativa', () => {
    expect(annualSavingsCents(14900, 151980)).toBe(14900 * 12 - 151980);
    expect(annualSavingsCents(100, 5000)).toBe(0);
  });
});

describe('dunning (estágios + grace + acesso)', () => {
  const due = new Date('2026-06-01T00:00:00Z');
  it('mapeia dias → estágio', () => {
    expect(dunningStageForDays(0)).toBe(0);
    expect(dunningStageForDays(1)).toBe(1);
    expect(dunningStageForDays(3)).toBe(3);
    expect(dunningStageForDays(7)).toBe(7);
    expect(dunningStageForDays(14)).toBe(7);
    expect(dunningStageForDays(15)).toBe(15);
    expect(dunningStageForDays(30)).toBe(30);
    expect(dunningStageForDays(99)).toBe(30);
  });
  it('acesso por estágio: D+15 readonly, D+30 blocked', () => {
    expect(accessForStage(7)).toBe('enabled');
    expect(accessForStage(15)).toBe('readonly');
    expect(accessForStage(30)).toBe('blocked');
  });
  it('grace period adia o atraso', () => {
    const now = new Date('2026-06-04T00:00:00Z'); // 3 dias após due
    expect(daysOverdue(due, now, null)).toBe(3);
    const grace = new Date('2026-06-05T00:00:00Z');
    expect(daysOverdue(due, now, grace)).toBe(0); // ainda no grace
  });
  it('evaluateDunning D+15 → readonly + sem canal de notificação', () => {
    const now = new Date('2026-06-16T00:00:00Z');
    const r = evaluateDunning(due, now, null);
    expect(r.stage).toBe(15);
    expect(r.access).toBe('readonly');
    expect(r.channel).toBeNull();
  });
});

describe('access mapping (billing→access; ADR-016)', () => {
  it('modo → clinics.status', () => {
    expect(accessModeToClinicStatus('enabled')).toBe('active');
    expect(accessModeToClinicStatus('readonly')).toBe('suspended_readonly');
    expect(accessModeToClinicStatus('blocked')).toBe('suspended');
  });
  // ADR-046: inadimplência bloqueia ESCRITA, nunca login/leitura. O prontuário é
  // registro médico-legal (CFM 1.821/2007 — ADR-017); trancar o profissional fora
  // dele por disputa comercial põe o produto entre ele e uma obrigação legal.
  // O `isLoginBlocked` que este teste cobria foi removido junto com a emenda.
  it('todo status de inadimplência bloqueia escrita', () => {
    expect(isWriteBlocked('suspended_readonly')).toBe(true);
    expect(isWriteBlocked('suspended')).toBe(true);
    expect(isWriteBlocked('pending_payment')).toBe(true);
    expect(isWriteBlocked('cancelled')).toBe(true);
  });

  it('status saudável não bloqueia escrita', () => {
    expect(isWriteBlocked('active')).toBe(false);
    expect(isWriteBlocked('trial')).toBe(false);
  });
});

describe('state machine (monotônica; webhook fora de ordem)', () => {
  it('invoice: paid é terminal (não volta a overdue)', () => {
    expect(canTransitionInvoice('open', 'paid')).toBe(true);
    expect(canTransitionInvoice('overdue', 'paid')).toBe(true);
    expect(canTransitionInvoice('paid', 'overdue')).toBe(false);
    expect(canTransitionInvoice('cancelled', 'paid')).toBe(false);
    expect(canTransitionInvoice('paid', 'paid')).toBe(true); // idempotente
  });
  it('billing: reativação comercial pode sair de cancelled', () => {
    expect(canTransitionBilling('trial', 'active')).toBe(true);
    expect(canTransitionBilling('active', 'past_due')).toBe(true);
    expect(canTransitionBilling('past_due', 'active')).toBe(true);
    expect(canTransitionBilling('cancelled', 'active')).toBe(true);
  });
});

describe('quota policy (ADR-024)', () => {
  it('agendamento não possui limite comercial', () => {
    const d = enforce('agendamento', 200, 200);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(Number.MAX_SAFE_INTEGER);
    expect(d.nearLimit).toBe(false);
  });
  it('conversa_ia não possui limite comercial', () => {
    expect(enforce('conversa_ia', 199, 200).allowed).toBe(true);
    expect(enforce('conversa_ia', 200, 200).allowed).toBe(true);
  });
  it('métrica por dimensão', () => {
    expect(metricForQuotaType('agendamento')).toBe('agendamentos');
    expect(metricForQuotaType('conversa_ia')).toBe('ai_messages');
  });
  it('ledger key: agendamento por appointment; IA por número+dia (1×/24h)', () => {
    const a = ledgerKeyFor('agendamento', { appointmentId: 'appt-1' });
    expect(a).toEqual({ metric: 'agendamentos', subjectId: 'appt-1', dedupKey: 'appt-1' });
    const i = ledgerKeyFor('conversa_ia', { fromNumberHash: 'hash9', dateUtc: '2026-06-17' });
    expect(i.dedupKey).toBe('hash9:2026-06-17');
    expect(i.metric).toBe('ai_messages');
  });
});
