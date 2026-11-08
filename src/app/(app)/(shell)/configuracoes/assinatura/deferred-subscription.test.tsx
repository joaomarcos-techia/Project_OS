// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeferredSubscription } from './deferred-subscription';

const baseline = {
  planName: 'Clínica',
  amountMinor: 39700,
  trialEndsAt: '2026-11-08T12:00:00.000Z',
  trialActive: false,
  paid: false,
  billingStatus: 'trial' as const,
  paidPeriodActive: false,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('deferred subscription controls', () => {
  it('does not deny that a charge may already exist while awaiting confirmation', () => {
    render(<DeferredSubscription {...baseline} />);
    expect(screen.getByText(/Se já pagou, não faça outra assinatura/)).toBeTruthy();
    expect(screen.queryByText(/Nenhuma cobrança inicial foi criada/)).toBeNull();
  });
  it('shows free trial and no checkout while the absolute deadline is active', () => {
    render(<DeferredSubscription {...baseline} trialActive />);
    expect(screen.getByText('Avaliação sem cartão')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Contratar assinatura' })).toBeNull();
  });
  it('does not offer another subscription after initial payment', () => {
    render(<DeferredSubscription {...baseline} paid paidPeriodActive billingStatus="active" />);
    expect(screen.getByText('Pagamento confirmado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Contratar assinatura' })).toBeNull();
  });
  it('shows renewal pending instead of reusing the initial checkout', () => {
    render(<DeferredSubscription {...baseline} paid billingStatus="past_due" />);
    expect(screen.getByText('Renovação em verificação')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Contratar assinatura' })).toBeNull();
  });
  it('does not originate on a cancelled contract', () => {
    render(<DeferredSubscription {...baseline} billingStatus="cancelled" />);
    expect(screen.queryByRole('button', { name: 'Contratar assinatura' })).toBeNull();
  });
  it('guards repeated clicks before React rerenders and transmits no price or tenant', async () => {
    const fetcher = vi.fn().mockReturnValue(new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetcher);
    render(<DeferredSubscription {...baseline} />);
    const button = screen.getByRole('button', { name: 'Contratar assinatura' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/billing/checkout',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });
  it('rejects a foreign redirect and presents recoverable feedback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ state: 'checkout_pending', checkoutUrl: 'https://evil.example/pay' }),
        ),
    );
    render(<DeferredSubscription {...baseline} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contratar assinatura' }));
    await waitFor(() =>
      expect(screen.getByText(/Não foi possível abrir a contratação/)).toBeTruthy(),
    );
  });
  it('keeps an ambiguous attempt for reconciliation instead of suggesting a second charge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'reconcile_required' }, { status: 409 })),
    );
    render(<DeferredSubscription {...baseline} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contratar assinatura' }));
    await waitFor(() => expect(screen.getByText(/Não crie outra cobrança/)).toBeTruthy());
  });
});
