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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('deferred subscription controls', () => {
  it('schedules a paid next-cycle plan once and does not promise an immediate doctor seat', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ state: 'scheduled' }));
    vi.stubGlobal('fetch', fetcher);
    render(
      <DeferredSubscription
        {...baseline}
        paid
        paidPeriodActive
        billingStatus="active"
        contractId="2d0c7853-147a-4b91-a178-3d081617c132"
        planChanges={{
          options: [
            {
              id: 'target-plan',
              name: 'Clínica — 3 médicos',
              code: 'clinica_2026_3',
              amountMinor: 54400,
            },
          ],
          pending: null,
        }}
      />,
    );
    expect(screen.getByText(/Não há cobrança proporcional nem liberação antecipada/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Plano para a próxima renovação'), {
      target: { value: 'target-plan' },
    });
    const button = screen.getByRole('button', { name: 'Agendar mudança para a próxima renovação' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/billing/plan-change',
      expect.objectContaining({
        body: JSON.stringify({
          contractId: '2d0c7853-147a-4b91-a178-3d081617c132',
          targetPlanId: 'target-plan',
        }),
      }),
    );
  });
  it('does not offer a replacement plan while a prior request is uncertain', () => {
    render(
      <DeferredSubscription
        {...baseline}
        paid
        planChanges={{
          options: [],
          pending: {
            planId: 'target',
            confirmed: false,
            effectiveNotBefore: '2026-12-01T12:00:00Z',
          },
        }}
      />,
    );
    expect(screen.getByText('Alteração em verificação')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  const managed = {
    ...baseline,
    paid: true,
    paidPeriodActive: true,
    billingStatus: 'active' as const,
    managementAvailable: true,
    contractId: '2d0c7853-147a-4b91-a178-3d081617c132',
    accessUntil: '2026-12-01T12:00:00.000Z',
    cancellationState: 'none' as const,
  };
  it('explains irreversible cancellation and asks before making a request', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    render(<DeferredSubscription {...managed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar renovação' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Esta ação é definitiva/)).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Manter assinatura' })).toBeNull();
  });
  it('deduplicates cancellation clicks and refreshes only after confirmation', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ state: 'renewal_cancelled' }));
    vi.stubGlobal('fetch', fetcher);
    render(<DeferredSubscription {...managed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar renovação' }));
    const button = screen.getByRole('button', { name: 'Confirmar cancelamento' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/billing/cancellation',
      expect.objectContaining({ body: JSON.stringify({ contractId: managed.contractId }) }),
    );
  });
  it('keeps uncertain cancellation visible without claiming the renewal stopped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'reconcile_required' }, { status: 409 })),
    );
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
    render(<DeferredSubscription {...managed} cancellationState="requested" />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar cancelamento' }));
    await waitFor(() => expect(screen.getByText(/Ainda não foi possível confirmar/)).toBeTruthy());
    expect(reload).not.toHaveBeenCalled();
  });
  it('does not offer a replacement while the cancelled paid period is active', () => {
    render(<DeferredSubscription {...managed} cancellationState="confirmed" />);
    expect(screen.getByText('Renovação cancelada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Contratar novamente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar renovação' })).toBeNull();
  });
  it('offers a new checkout only after the server confirms the ended cancellation', () => {
    render(
      <DeferredSubscription
        {...managed}
        cancellationState="confirmed"
        paidPeriodActive={false}
        canRecontract
        billingStatus="cancelled"
      />,
    );
    expect(screen.getByText('Assinatura encerrada')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contratar novamente' })).toBeTruthy();
    expect(screen.queryByText('Renovação em verificação')).toBeNull();
    expect(screen.getByText(/Não haverá uma nova avaliação gratuita/)).toBeTruthy();
  });
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
  it('refreshes the subscription after authoritative recovery without reopening checkout', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'already_paid' }, { status: 409 })),
    );
    render(<DeferredSubscription {...baseline} />);
    fireEvent.click(screen.getByRole('button', { name: 'Contratar assinatura' }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(assign).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
