// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ guard: vi.fn(), operations: vi.fn(), replay: vi.fn() }));
vi.mock('../../_lib/guard', () => ({ guardAdminAccess: m.guard }));
vi.mock('../../_lib/repositories/abacatepay-operations.repo', () => ({
  getAbacatePayOperations: m.operations,
}));
vi.mock('../../actions/abacatepay-review', () => ({ replayAbacatePayReviewAction: m.replay }));
import BillingOperationsPage from './page';

const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.resetAllMocks();
  m.operations.mockResolvedValue(null);
});
afterEach(cleanup);
describe('operator review screen', () => {
  it('does not read financial data before the superadmin guard', async () => {
    m.guard.mockRejectedValue(new Error('forbidden'));
    await expect(BillingOperationsPage()).rejects.toThrow('forbidden');
    expect(m.operations).not.toHaveBeenCalled();
  });
  it('shows the runtime restriction without exposing an actionable form', async () => {
    render(await BillingOperationsPage());
    expect(
      screen.getByText(
        'Operação financeira indisponível neste ambiente ou sem configuração autorizada.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('shows review/cycle evidence, protects TOTP and never offers an arbitrary financial edit', async () => {
    m.operations.mockResolvedValue({
      backlog: { reviews: 2, queued: 1, oldest: new Date('2026-11-10T00:00:00Z') },
      pixIntents: [
        {
          id,
          clinic_id: id,
          subscription_id: id,
          to_plan_id: id,
          target_amount_minor: 39700,
          prior_period_end: new Date('2026-12-24T00:00:00Z'),
          requested_at: new Date('2026-11-25T00:00:00Z'),
          state: 'requested',
        },
      ],
      quarantined: [],
      renewals: [
        {
          subscription_id: id,
          clinic_id: id,
          period_end: new Date('2026-11-09T00:00:00Z'),
          created_at: new Date('2026-11-10T00:00:00Z'),
        },
      ],
      reviews: [
        {
          account_id: id,
          event_id: 'log_synthetic',
          clinic_id: id,
          snapshot: 'a'.repeat(64),
          event_type: 'subscription.renewed',
          attempts: 10,
          replay_count: 0,
          outcome_code: 'readback_failed',
        },
      ],
    });
    const { container } = render(await BillingOperationsPage());
    expect(screen.getByText('2 em revisão; 1 aguardando processamento.')).toBeTruthy();
    expect(screen.getByText(/Aguardando atendimento/u)).toBeTruthy();
    expect(screen.getByText(/Pedido não autoriza cobrança/u)).toBeTruthy();
    expect(screen.getByLabelText('Código atual do autenticador').getAttribute('type')).toBe(
      'password',
    );
    expect(
      container.querySelector('[name="amount"], [name="periodEnd"], [name="paymentId"]'),
    ).toBeNull();
    m.replay.mockResolvedValue({ error: null, message: 'O evento continua em revisão.' });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Autorizar uma nova leitura' }).closest('form')!,
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('O evento continua em revisão.'),
    );
  });
  it('disables submission when the daily replay limit was reached', async () => {
    m.operations.mockResolvedValue({
      backlog: { reviews: 1, queued: 0, oldest: null },
      pixIntents: [],
      renewals: [],
      quarantined: [],
      reviews: [
        {
          account_id: id,
          event_id: 'log_limited',
          clinic_id: id,
          snapshot: 'a'.repeat(64),
          event_type: 'subscription.renewed',
          attempts: 13,
          replay_count: 3,
          outcome_code: null,
        },
      ],
    });
    render(await BillingOperationsPage());
    expect(
      screen
        .getByRole('button', { name: 'Limite de reprocessamento atingido' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
  it('exposes an unbound event for investigation without a replay form', async () => {
    m.operations.mockResolvedValue({
      backlog: { reviews: 1, queued: 0, oldest: null },
      pixIntents: null,
      renewals: [],
      reviews: [],
      quarantined: [
        {
          account_id: id,
          event_id: 'log_quarantine',
          event_type: 'subscription.renewed',
          outcome_code: 'unmatched_fixture',
        },
      ],
    });
    render(await BillingOperationsPage());
    expect(screen.getByText(/Revisão sem reprocessamento disponível: log_quarantine/)).toBeTruthy();
    expect(screen.getByText(/Pedidos indisponíveis até a migration/u)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
