import { expect, it, vi } from 'vitest';
import { TrialAccessError } from '@/lib/trial-access/policy';
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/contexts/financial/actions', () => ({ createLancamento: vi.fn() }));
import { createLancamento } from '@/contexts/financial/actions';
import { createLancamentoFormAction } from './lancamento-actions';

it('shows a receivable quota message without returning a raw database exception', async () => {
  const error = new TrialAccessError('receivables');
  vi.mocked(createLancamento).mockRejectedValueOnce(error);
  const form = new FormData();
  form.set('tipo', 'receber');
  form.set('descricao', 'Synthetic');
  form.set('valor', '100');
  form.set('idempotencyKey', '33333333-3333-4333-8333-333333333333');
  expect(await createLancamentoFormAction({ error: null }, form)).toEqual({ error: error.message });
});
