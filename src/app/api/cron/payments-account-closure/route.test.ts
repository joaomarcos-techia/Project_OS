import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  listPaused: vi.fn(),
  readState: vi.fn(),
  recordNotice: vi.fn(),
  close: vi.fn(),
  ownerEmails: vi.fn(),
  send: vi.fn(),
  heartbeat: vi.fn(),
  emit: vi.fn(),
  envState: {
    value: {
      CRON_SECRET: 'c'.repeat(32),
      CRON_SECRET_DESTRUCTIVE: undefined as string | undefined,
      OUTBOX_CRON_ALLOW_NON_VERCEL: true,
      NODE_ENV: 'test',
    },
  },
}));

vi.mock('@/lib/payments/account-store', () => ({
  listPausedPaymentAccounts: m.listPaused,
  readPaymentAccountClosureState: m.readState,
  recordPaymentAccountClosureNotice: m.recordNotice,
  closePausedPaymentAccount: m.close,
}));
vi.mock('@/contexts/identity/queries', () => ({ listActiveOwnerEmails: m.ownerEmails }));
vi.mock('@/lib/email/resend', () => ({ sendTransactionalEmail: m.send }));
vi.mock('@/lib/http/application-url', () => ({
  createPaymentSettingsUrl: () => 'https://app.qoro.test/configuracoes/pagamentos',
}));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: m.heartbeat }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: m.emit } }));
vi.mock('@/lib/observability/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: vi.fn() }));
vi.mock('@/lib/env', () => ({
  get env() {
    return m.envState.value;
  },
  assertCronRuntimeReady: vi.fn(),
}));

import { GET } from './route';

const DAY = 86_400_000;
const NOW = new Date('2027-04-10T10:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const NO_BLOCKERS = { openLinks: 0, pendingRefunds: 0, openDisputes: 0 };

const request = (secret: string | undefined = 'c'.repeat(32)) =>
  new Request('https://localhost/api/cron/payments-account-closure', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

function pausedState(over: Record<string, unknown> = {}) {
  return {
    active: true,
    paused: true,
    blockers: NO_BLOCKERS,
    lastActivityAt: daysAgo(151),
    noticeSentAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  m.heartbeat.mockResolvedValue(undefined);
  m.listPaused.mockResolvedValue([{ clinicId: 'clinic-1', clinicName: 'Clínica Exemplo' }]);
  m.ownerEmails.mockResolvedValue(['dono@clinica.test', 'socia@clinica.test']);
  m.send.mockResolvedValue({ providerMessageId: 'msg' });
  m.recordNotice.mockResolvedValue(true);
  m.close.mockResolvedValue({ outcome: 'closed' });
});
afterEach(() => vi.useRealTimers());

describe('cron de encerramento da conta Asaas pausada', () => {
  it('sem o segredo do cron não lê nem altera nada', async () => {
    const res = await GET(request('x'.repeat(32)));
    expect(res.status).toBe(401);
    expect(m.listPaused).not.toHaveBeenCalled();
    expect(m.close).not.toHaveBeenCalled();
  });

  it('aos 150 dias avisa cada dono uma vez e registra o aviso', async () => {
    m.readState.mockResolvedValue(pausedState());

    const res = await GET(request());

    expect(await res.json()).toEqual({
      ok: true,
      accounts: 1,
      noticed: 1,
      closed: 0,
      blocked: 0,
      failed: 0,
    });
    const window = daysAgo(151).toISOString();
    expect(m.send).toHaveBeenCalledTimes(2);
    expect(m.send.mock.calls.map(([input]) => [input.to, input.idempotencyKey])).toEqual([
      ['dono@clinica.test', `payment-account-closure/clinic-1/${window}/0`],
      ['socia@clinica.test', `payment-account-closure/clinic-1/${window}/1`],
    ]);
    expect(m.send.mock.calls[0]?.[0].subject).toContain('Clínica Exemplo');
    // O aviso saiu no dia 151, não no 150: o encerramento fica 30 dias depois DELE.
    expect(m.recordNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-1',
        recipients: 2,
        closeAt: new Date(NOW.getTime() + 30 * DAY),
      }),
    );
    expect(m.close).not.toHaveBeenCalled();
    expect(m.heartbeat).toHaveBeenCalledWith('payments-account-closure', 'success', {
      accounts: 1,
      noticed: 1,
      closed: 0,
      blocked: 0,
      failed: 0,
    });
  });

  it('aos 180 dias, com aviso de 30 dias antes, encerra como inatividade e sem usuário', async () => {
    m.readState.mockResolvedValue(
      pausedState({ lastActivityAt: daysAgo(181), noticeSentAt: daysAgo(31) }),
    );

    const res = await GET(request());

    expect((await res.json()) as unknown).toMatchObject({ closed: 1, noticed: 0 });
    expect(m.close).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1', userId: null, trigger: 'inactivity' }),
    );
    expect(m.send).not.toHaveBeenCalled();
    expect(m.emit).toHaveBeenCalledWith('payments.account.closed', {
      clinicId: 'clinic-1',
      trigger: 'inactivity',
    });
  });

  it('com pendência não avisa nem encerra', async () => {
    m.readState.mockResolvedValue(
      pausedState({
        lastActivityAt: daysAgo(400),
        noticeSentAt: daysAgo(100),
        blockers: { ...NO_BLOCKERS, pendingRefunds: 1 },
      }),
    );

    const res = await GET(request());

    expect((await res.json()) as unknown).toMatchObject({ blocked: 1, closed: 0, noticed: 0 });
    expect(m.send).not.toHaveBeenCalled();
    expect(m.close).not.toHaveBeenCalled();
  });

  it('sem dono com e-mail, não registra aviso — e por isso não encerra depois', async () => {
    m.readState.mockResolvedValue(pausedState());
    m.ownerEmails.mockResolvedValue([]);

    const res = await GET(request());

    expect((await res.json()) as unknown).toMatchObject({ noticed: 0 });
    expect(m.recordNotice).not.toHaveBeenCalled();
    expect(m.emit).toHaveBeenCalledWith('payments.account_closure.no_recipient', {
      clinicId: 'clinic-1',
    });
  });

  it('falha numa clínica não interrompe as outras e marca o heartbeat como erro', async () => {
    m.listPaused.mockResolvedValue([
      { clinicId: 'clinic-1', clinicName: 'A' },
      { clinicId: 'clinic-2', clinicName: 'B' },
    ]);
    m.readState
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(
        pausedState({ lastActivityAt: daysAgo(181), noticeSentAt: daysAgo(31) }),
      );

    const res = await GET(request());

    expect((await res.json()) as unknown).toMatchObject({ ok: false, failed: 1, closed: 1 });
    expect(m.close).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-2' }));
    expect(m.heartbeat).toHaveBeenCalledWith(
      'payments-account-closure',
      'error',
      expect.objectContaining({ failed: 1, closed: 1 }),
    );
  });
});
