import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __testing__ } from './subscriptions';

import type { Tx } from '@/lib/db';

describe('subscription.activated planCode', () => {
  it.each(['solo', 'clinica', 'pro'] as const)(
    'preserva o plano real %s no contrato do evento',
    (planCode) => {
      expect(__testing__.toPlanCode(planCode)).toBe(planCode);
    },
  );

  it('falha fechado para plano fora do contrato público', () => {
    expect(() => __testing__.toPlanCode('enterprise')).toThrow(/plano não suportado/);
  });

  it('activateSubscription busca o plano vinculado e não publica Solo fixo', () => {
    const source = readFileSync(new URL('./subscriptions.ts', import.meta.url), 'utf8');
    const activation = source.slice(
      source.indexOf('export async function activateSubscription'),
      source.indexOf('/**\n * Materializa a invoice'),
    );

    expect(activation).toContain('.innerJoin(plans, eq(plans.id, subscriptions.planId))');
    expect(activation).toContain('planCode: toPlanCode(sub.planCode)');
    expect(activation).not.toContain("planCode: 'solo'");
  });
});

// ---------------------------------------------------------------------------
// BILLING-001 — o período pago tem de ser aberto na confirmação da cobrança.
//
// `tx` roteirizada: devolve resultados na ordem em que o código os consome e
// registra o que foi escrito. Não valida SQL — valida a DECISÃO, que é onde
// estava o defeito (a subscription simplesmente nunca era avançada).
// ---------------------------------------------------------------------------

interface Written {
  table: 'invoices' | 'subscriptions';
  values: Record<string, unknown>;
}

const written: Written[] = [];
const billingEventsRecorded: Array<Record<string, unknown>> = [];

function chain(result: unknown[], onSet?: (values: Record<string, unknown>) => void) {
  const self: Record<string, unknown> = {};
  for (const key of ['from', 'innerJoin', 'where', 'limit', 'returning']) {
    self[key] = () => self;
  }
  self.set = (values: Record<string, unknown>) => {
    onSet?.(values);
    return self;
  };
  self.values = (values: Record<string, unknown>) => {
    billingEventsRecorded.push(values);
    return self;
  };
  self.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onOk, onErr);
  return self;
}

/** `subscription` = linha do join subscriptions×prices; `null` = sem assinatura. */
function scriptedTx(subscription: Record<string, unknown> | null): Tx {
  let updateCount = 0;
  return {
    select: () => chain(subscription ? [subscription] : []),
    update: () =>
      chain([], (values) => {
        // A 1ª escrita é a invoice; a 2ª é a subscription (ordem do código).
        written.push({ table: updateCount++ === 0 ? 'invoices' : 'subscriptions', values });
      }),
    insert: () => chain([]),
  } as unknown as Tx;
}

const CLINIC = 'clinic-a';

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    clinicId: CLINIC,
    dueDate: '2026-08-24',
    periodStart: null,
    periodEnd: null,
    status: 'paid',
    ...over,
  } as never;
}

beforeEach(() => {
  written.length = 0;
  billingEventsRecorded.length = 0;
  vi.restoreAllMocks();
});

describe('advanceBillingPeriod (BILLING-001)', () => {
  it('trial → pago: abre o período na invoice E avança a subscription', async () => {
    // O achado exato: a clínica virava `active` com current_period_* ainda
    // apontando para o trial encerrado (null/antigo).
    const tx = scriptedTx({ id: 'sub-1', cycle: 'monthly', currentPeriodEnd: null });

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice());

    expect(written).toHaveLength(2);
    expect(written[0]).toEqual({
      table: 'invoices',
      values: { periodStart: '2026-08-24', periodEnd: '2026-09-24' },
    });
    expect(written[1]!.table).toBe('subscriptions');
  });

  it('ciclo anual soma um ano', async () => {
    const tx = scriptedTx({ id: 'sub-1', cycle: 'annual', currentPeriodEnd: null });

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice());

    expect(written[0]!.values).toEqual({ periodStart: '2026-08-24', periodEnd: '2027-08-24' });
  });

  it('vencimento em 31/01 fecha em 28/02, sem pular mês', async () => {
    const tx = scriptedTx({ id: 'sub-1', cycle: 'monthly', currentPeriodEnd: null });

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice({ dueDate: '2026-01-31' }));

    expect(written[0]!.values).toEqual({ periodStart: '2026-01-31', periodEnd: '2026-02-28' });
  });

  it('fevereiro bissexto', async () => {
    const tx = scriptedTx({ id: 'sub-1', cycle: 'monthly', currentPeriodEnd: null });

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice({ dueDate: '2028-01-31' }));

    expect(written[0]!.values).toEqual({ periodStart: '2028-01-31', periodEnd: '2028-02-29' });
  });

  it('replay do mesmo pagamento não reescreve nada', async () => {
    // Webhook duplicado / reconcile depois do webhook: a invoice já tem período
    // e a subscription já está no ciclo — nenhuma das duas escritas ocorre.
    const tx = scriptedTx({
      id: 'sub-1',
      cycle: 'monthly',
      currentPeriodEnd: new Date('2026-09-24T00:00:00Z'),
    });

    await __testing__.advanceBillingPeriod(
      tx,
      CLINIC,
      invoice({ periodStart: '2026-08-24', periodEnd: '2026-09-24' }),
    );

    expect(written).toHaveLength(0);
  });

  it('pagamento tardio de invoice ANTIGA não regride o ciclo corrente', async () => {
    const tx = scriptedTx({
      id: 'sub-1',
      cycle: 'monthly',
      currentPeriodEnd: new Date('2026-09-24T00:00:00Z'),
    });

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice({ dueDate: '2026-06-24' }));

    // A invoice antiga ganha o período dela (registro correto do que foi pago),
    // mas a subscription NÃO volta para julho.
    expect(written.map((w) => w.table)).toEqual(['invoices']);
    expect(written[0]!.values).toEqual({ periodStart: '2026-06-24', periodEnd: '2026-07-24' });
  });

  it('reentrega sobre invoice já paga REPARA período ausente', async () => {
    // Uma cobrança confirmada antes desta correção ficou sem período. A
    // reentrega do webhook conserta em vez de ignorar.
    const tx = scriptedTx({
      id: 'sub-1',
      cycle: 'monthly',
      currentPeriodEnd: new Date('2026-09-24T00:00:00Z'),
    });

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice({ status: 'paid' }));

    expect(written[0]).toEqual({
      table: 'invoices',
      values: { periodStart: '2026-08-24', periodEnd: '2026-09-24' },
    });
  });

  it('sem subscription/preço (cobrança avulsa) não inventa período', async () => {
    const tx = scriptedTx(null);

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice());

    expect(written).toHaveLength(0);
  });

  it('o avanço deixa rastro na timeline da conta', async () => {
    const tx = scriptedTx({ id: 'sub-1', cycle: 'monthly', currentPeriodEnd: null });

    await __testing__.advanceBillingPeriod(tx, CLINIC, invoice());

    expect(billingEventsRecorded).toContainEqual(
      expect.objectContaining({ type: 'subscription.period_advanced' }),
    );
  });
});

describe('markInvoicePaid abre o período antes de ativar', () => {
  const source = readFileSync(new URL('./subscriptions.ts', import.meta.url), 'utf8');
  const paid = source.slice(
    source.indexOf('export async function markInvoicePaid'),
    source.indexOf('async function advanceBillingPeriod'),
  );

  it('chama advanceBillingPeriod ANTES de activateSubscription', () => {
    // Quem lê a subscription no evento de ativação precisa ver o ciclo novo.
    expect(paid.indexOf('advanceBillingPeriod')).toBeGreaterThan(-1);
    expect(paid.indexOf('advanceBillingPeriod')).toBeLessThan(paid.indexOf('activateSubscription'));
  });

  it('o período NÃO fica preso ao ramo da transição — reentrega repara', () => {
    const transitionBranch = paid.slice(
      paid.indexOf("canTransitionInvoice(invoice.status, 'paid')"),
      paid.indexOf('advanceBillingPeriod'),
    );
    expect(transitionBranch).not.toContain('advanceBillingPeriod');
  });

  it('refund não retrocede o período', () => {
    const refunded = source.slice(
      source.indexOf('export async function markInvoiceRefunded'),
      source.indexOf('export const __testing__'),
    );
    // A CHAMADA é o que importa; o arquivo menciona o nome em comentário.
    expect(refunded).not.toContain('await advanceBillingPeriod');
  });
});
