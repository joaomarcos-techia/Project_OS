/**
 * BILLING-001 — testes temporais do período de cobrança.
 *
 * O achado: `markInvoicePaid()` marcava a invoice paga e ativava a clínica sem
 * abrir o novo período; `current_period_*` continuava no trial encerrado. Estes
 * testes fixam a regra GERAL de derivação — nada aqui depende de "hoje", que é
 * justamente a propriedade que faltava (um webhook atrasado, um reconcile do dia
 * seguinte e um replay têm que produzir o mesmo período).
 */
import { describe, expect, it } from 'vitest';

import {
  addCalendarMonths,
  billingPeriodFor,
  shouldAdvanceSubscriptionPeriod,
} from './billing-period';

describe('addCalendarMonths — meses de calendário com clamp de fim de mês', () => {
  it('soma trivial no meio do mês', () => {
    expect(addCalendarMonths('2026-08-24', 1)).toBe('2026-09-24');
  });

  it('31/01 + 1 mês = 28/02, não 03/03', () => {
    // Sem o clamp, a data inválida vira overflow e o ciclo PULA um mês.
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('respeita fevereiro bissexto', () => {
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addCalendarMonths('2028-02-29', 12)).toBe('2029-02-28');
  });

  it('31/03 + 1 mês = 30/04 (mês de 30 dias)', () => {
    expect(addCalendarMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('atravessa a virada do ano', () => {
    expect(addCalendarMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addCalendarMonths('2026-12-31', 1)).toBe('2027-01-31');
  });

  it('anual = 12 meses', () => {
    expect(addCalendarMonths('2026-08-24', 12)).toBe('2027-08-24');
  });

  it('recusa data-calendário inválida em vez de inventar um período', () => {
    expect(() => addCalendarMonths('2026-02-30', 1)).toThrow(/inválida/u);
    expect(() => addCalendarMonths('2026-13-01', 1)).toThrow(/inválida/u);
    expect(() => addCalendarMonths('24/08/2026', 1)).toThrow(/inválida/u);
  });
});

describe('billingPeriodFor — o período que a cobrança paga abriu', () => {
  it('mensal: começa no vencimento e termina na próxima renovação', () => {
    // A primeira cobrança da Clínica A: o período tem de sair daqui, não do
    // trial que acabou.
    expect(billingPeriodFor('2026-08-24', 'monthly')).toEqual({
      start: '2026-08-24',
      end: '2026-09-24',
    });
  });

  it('anual: um ano de calendário', () => {
    expect(billingPeriodFor('2026-08-24', 'annual')).toEqual({
      start: '2026-08-24',
      end: '2027-08-24',
    });
  });

  it('é função pura do vencimento: mesmo resultado no webhook, no reconcile e no replay', () => {
    // Derivar de `now()` faria o período depender de QUANDO o evento chegou.
    const first = billingPeriodFor('2026-01-31', 'monthly');
    const later = billingPeriodFor('2026-01-31', 'monthly');
    expect(first).toEqual(later);
    expect(first.end).toBe('2026-02-28');
  });
});

describe('shouldAdvanceSubscriptionPeriod — o ciclo só anda para frente', () => {
  it('trial (sem período) aceita qualquer período', () => {
    expect(shouldAdvanceSubscriptionPeriod(null, '2026-09-24')).toBe(true);
  });

  it('avança quando o período novo termina depois', () => {
    expect(shouldAdvanceSubscriptionPeriod(new Date('2026-09-24T00:00:00Z'), '2026-10-24')).toBe(
      true,
    );
  });

  it('replay do MESMO pagamento não avança duas vezes', () => {
    expect(shouldAdvanceSubscriptionPeriod(new Date('2026-09-24T00:00:00Z'), '2026-09-24')).toBe(
      false,
    );
  });

  it('pagamento tardio de invoice ANTIGA não regride o ciclo corrente', () => {
    // Cobrança de junho paga em setembro: regulariza o acesso, mas o ciclo
    // vigente não pode voltar para julho.
    expect(shouldAdvanceSubscriptionPeriod(new Date('2026-09-24T00:00:00Z'), '2026-07-24')).toBe(
      false,
    );
  });

  it('a comparação é por data-calendário, não por instante', () => {
    // `current_period_end` gravado como meia-noite UTC; um período que termina
    // no MESMO dia não é avanço, mesmo com horas diferentes na coluna.
    expect(shouldAdvanceSubscriptionPeriod(new Date('2026-09-24T23:59:59Z'), '2026-09-24')).toBe(
      false,
    );
    expect(shouldAdvanceSubscriptionPeriod(new Date('2026-09-24T23:59:59Z'), '2026-09-25')).toBe(
      true,
    );
  });
});
