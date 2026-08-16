/**
 * BILLING-002 — matriz de reconciliação local × provedor.
 *
 * O achado: `ensureInvoiceForPayment()` devolve a invoice existente sem olhar
 * `due_date`, `total_amount` ou remoção. Uma edição no painel do Asaas ficava
 * divergente para sempre, e uma cobrança EXCLUÍDA seguia `open` local — com o
 * dunning perseguindo algo que não existe mais.
 *
 * Os cenários A–G do escopo estão nomeados nos testes.
 */
import { describe, expect, it } from 'vitest';

import {
  decideProviderSync,
  providerStatusToInvoiceStatus,
  type LocalInvoiceState,
} from './provider-sync';

function local(over: Partial<LocalInvoiceState> = {}): LocalInvoiceState {
  return { status: 'open', dueDate: '2026-08-24', totalCents: 19_900, ...over };
}

const PROVIDER_SAME = {
  exists: true,
  dueDate: '2026-08-24',
  totalCents: 19_900,
  status: 'open' as const,
};

describe('decideProviderSync — cenários do escopo', () => {
  it('A: LOCAL open × PROVIDER open, tudo igual → nenhuma alteração indevida', () => {
    expect(decideProviderSync(local(), PROVIDER_SAME)).toEqual({
      kind: 'noop',
      reason: 'in_sync',
    });
  });

  it('B: LOCAL open × PROVIDER removido e CONFIRMADO → cancela', () => {
    const action = decideProviderSync(
      local(),
      { exists: false },
      { providerConfirmedMissing: true },
    );
    expect(action).toEqual({ kind: 'terminalize', status: 'cancelled' });
  });

  it('B-negativo: removido SEM confirmação → divergência, nunca cancelamento', () => {
    // O corpo do webhook é autenticado só por token estático compartilhado.
    // Acreditar nele deixaria qualquer um cancelar cobrança alheia.
    const action = decideProviderSync(local(), { exists: false });
    expect(action).toEqual({ kind: 'flag_divergence', reason: 'provider_missing_unconfirmed' });
  });

  it('C: LOCAL open × PROVIDER paid → terminaliza pelo caminho de pagamento', () => {
    const action = decideProviderSync(local(), { ...PROVIDER_SAME, status: 'paid' });
    expect(action).toEqual({ kind: 'terminalize', status: 'paid' });
  });

  it('D: due_date divergente → atualiza a data, sem tocar no valor', () => {
    const action = decideProviderSync(local(), { ...PROVIDER_SAME, dueDate: '2026-09-05' });
    expect(action).toEqual({ kind: 'update', dueDate: '2026-09-05', amountChanged: false });
  });

  it('E: valor divergente → atualiza e SINALIZA a mudança de valor', () => {
    const action = decideProviderSync(local(), { ...PROVIDER_SAME, totalCents: 24_900 });
    expect(action).toEqual({ kind: 'update', totalCents: 24_900, amountChanged: true });
  });

  it('E: data e valor divergentes ao mesmo tempo', () => {
    const action = decideProviderSync(local(), {
      ...PROVIDER_SAME,
      dueDate: '2026-09-05',
      totalCents: 24_900,
    });
    expect(action).toEqual({
      kind: 'update',
      dueDate: '2026-09-05',
      totalCents: 24_900,
      amountChanged: true,
    });
  });

  it('F/G: a decisão é função pura do par (local, provedor) — replay dá o mesmo', () => {
    // Duas sincronizações simultâneas ou um retry chegam à MESMA decisão; a
    // exclusão mútua do efeito fica com o compare-and-swap na escrita.
    const first = decideProviderSync(local(), { ...PROVIDER_SAME, dueDate: '2026-09-05' });
    const second = decideProviderSync(local(), { ...PROVIDER_SAME, dueDate: '2026-09-05' });
    expect(first).toEqual(second);

    // Depois de aplicada, a mesma decisão vira noop (o local já mudou).
    const after = decideProviderSync(local({ dueDate: '2026-09-05' }), {
      ...PROVIDER_SAME,
      dueDate: '2026-09-05',
    });
    expect(after.kind).toBe('noop');
  });
});

describe('decideProviderSync — terminais não regridem', () => {
  it('invoice PAGA ignora update de data/valor atrasado', () => {
    const action = decideProviderSync(local({ status: 'paid' }), {
      ...PROVIDER_SAME,
      dueDate: '2026-09-05',
      totalCents: 24_900,
    });
    expect(action).toEqual({ kind: 'noop', reason: 'local_terminal:paid' });
  });

  it('invoice PAGA não é cancelada por um delete atrasado', () => {
    // Delete NUNCA vira estorno, e uma cobrança quitada não some do histórico.
    const action = decideProviderSync(
      local({ status: 'paid' }),
      { exists: false },
      { providerConfirmedMissing: true },
    );
    expect(action).toEqual({ kind: 'noop', reason: 'local_terminal:paid' });
  });

  it('invoice já CANCELADA é terminal', () => {
    const action = decideProviderSync(local({ status: 'cancelled' }), PROVIDER_SAME);
    expect(action.kind).toBe('noop');
  });

  it('invoice OVERDUE ainda aceita reconciliação de data/valor', () => {
    const action = decideProviderSync(local({ status: 'overdue' }), {
      ...PROVIDER_SAME,
      dueDate: '2026-09-05',
    });
    expect(action).toEqual({ kind: 'update', dueDate: '2026-09-05', amountChanged: false });
  });
});

describe('decideProviderSync — leitura parcial', () => {
  it('sem data nem valor legíveis não inventa update', () => {
    expect(decideProviderSync(local(), { exists: true })).toEqual({
      kind: 'noop',
      reason: 'in_sync',
    });
  });

  it('valor nulo do provedor não zera a invoice', () => {
    // Um `value: null` seria lido como 0 centavos e a cobrança viraria grátis.
    expect(decideProviderSync(local(), { ...PROVIDER_SAME, totalCents: null }).kind).toBe('noop');
  });
});

describe('providerStatusToInvoiceStatus', () => {
  it('traduz os status pagos do Asaas', () => {
    for (const s of ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']) {
      expect(providerStatusToInvoiceStatus(s)).toBe('paid');
    }
  });

  it('OVERDUE e PENDING mantêm a invoice mutável', () => {
    expect(providerStatusToInvoiceStatus('OVERDUE')).toBe('overdue');
    expect(providerStatusToInvoiceStatus('PENDING')).toBe('open');
  });

  it('REFUNDED NÃO é status de invoice — o estorno vive em payment_attempts', () => {
    expect(providerStatusToInvoiceStatus('REFUNDED')).toBeNull();
  });

  it('status desconhecido não decide nada', () => {
    expect(providerStatusToInvoiceStatus('CHARGEBACK_DISPUTE')).toBeNull();
  });
});
