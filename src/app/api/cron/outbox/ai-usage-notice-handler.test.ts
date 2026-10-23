import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  owners: vi.fn(),
  send: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerDetachedHandler: mocks.register }));
vi.mock('@/contexts/identity/queries', () => ({ listActiveOwnerEmails: mocks.owners }));
vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail: mocks.send }));

import { aiUsageNoticeContent } from './ai-usage-notice-handler';

const registration = mocks.register.mock.calls[0]!;
const handler = registration[1] as (ctx: {
  clinicId: string;
  payload: {
    clinicId: string;
    period: string;
    threshold: 80 | 100;
    count: number;
    limit: number;
  };
}) => Promise<void>;
const payload = {
  clinicId: 'clinic-1',
  period: '2026-10',
  threshold: 80 as const,
  count: 400,
  limit: 500,
};

beforeEach(() => {
  mocks.owners.mockReset().mockResolvedValue(['owner@example.test']);
  mocks.send.mockReset().mockResolvedValue({ providerMessageId: 'email-1' });
});

describe('aviso de referência mensal de IA', () => {
  it('registra a entrega fora da transação do metering', () => {
    expect(registration[0]).toBe('billing.ai_usage.notice_requested');
  });

  it('envia ao titular sem dados clínicos nem cobrança de excedente', async () => {
    await handler({ clinicId: 'clinic-1', payload });
    expect(mocks.owners).toHaveBeenCalledWith('clinic-1');
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.test',
        subject: expect.stringContaining('80%'),
        text: expect.stringContaining('A IA continua atendendo'),
      }),
    );
    const input = mocks.send.mock.calls[0]?.[0] as { idempotencyKey: string; html: string };
    expect(input.idempotencyKey).not.toContain('owner@example.test');
    expect(input.html).not.toContain('owner@example.test');
  });

  it('mesma clínica, mês e titular usam chave estável para retry', async () => {
    await handler({ clinicId: 'clinic-1', payload });
    const first = (mocks.send.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey;
    await handler({ clinicId: 'clinic-1', payload });
    const second = (mocks.send.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey;
    expect(second).toBe(first);
  });

  it('novo limite após upgrade usa outra chave para entregar o novo aviso', async () => {
    await handler({ clinicId: 'clinic-1', payload });
    await handler({
      clinicId: 'clinic-1',
      payload: { ...payload, count: 800, limit: 1000 },
    });
    const first = (mocks.send.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey;
    const second = (mocks.send.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey;
    expect(second).not.toBe(first);
    expect(second).toContain('/1000/80/');
  });

  it('ausência de titular ou falha do Resend propagam para retry', async () => {
    mocks.owners.mockResolvedValueOnce([]);
    await expect(handler({ clinicId: 'clinic-1', payload })).rejects.toThrow('Nenhum titular');
    mocks.send.mockRejectedValueOnce(new Error('Resend indisponível'));
    await expect(handler({ clinicId: 'clinic-1', payload })).rejects.toThrow('Resend indisponível');
  });

  it('conteúdo de 100% afirma que a IA segue ativa', () => {
    const content = aiUsageNoticeContent({ ...payload, threshold: 100, count: 500 });
    expect(content.subject).toContain('100%');
    expect(content.text).toContain('não há cobrança automática de excedente');
  });
});
