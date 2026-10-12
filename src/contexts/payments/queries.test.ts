/**
 * Leitura do estado da conta de pagamento.
 *
 * O teste que importa aqui não é o mapeamento do DTO — é a SQL. A coluna do
 * segredo está fora do grant de `authenticated` (migration 0081), então um
 * `SELECT *` ou um "só mais essa coluna" adicionado no futuro derrubaria a tela
 * com erro de permissão em produção. Este teste falha primeiro, no CI.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenantMock, closureStateMock } = vi.hoisted(() => ({
  withTenantMock: vi.fn(),
  closureStateMock: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: withTenantMock }));
// Contagens e data do aviso vêm do seam privilegiado (a coluna do aviso fica fora
// do grant de `authenticated`, como a credencial).
vi.mock('@/lib/payments/account-store', () => ({
  readPaymentAccountClosureState: closureStateMock,
}));

import { DEPOSIT_POLICY_OFF } from './policy';
import { getDepositPolicy, getPaymentAccountStatus } from './queries';
import { EMPTY_PAYMENT_ACCOUNT } from './types';

const dialect = new PgDialect();

/** Captura a SQL compilada e devolve as linhas pré-setadas. */
function stubTenantRead(rows: unknown[]): { sqls: string[] } {
  const sqls: string[] = [];
  withTenantMock.mockImplementation((async (_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async (q: SQL) => {
        sqls.push(dialect.sqlToQuery(q).sql);
        return rows;
      },
    })) as never);
  return { sqls };
}

beforeEach(() => {
  vi.clearAllMocks();
  closureStateMock.mockResolvedValue({
    active: true,
    paused: false,
    blockers: { openLinks: 0, pendingRefunds: 0, openDisputes: 0 },
    lastActivityAt: new Date('2026-10-07T12:00:00.000Z'),
    noticeSentAt: null,
  });
});

describe('getPaymentAccountStatus', () => {
  it('NUNCA pede as colunas do segredo (nem por SELECT *)', async () => {
    const { sqls } = stubTenantRead([]);

    await getPaymentAccountStatus('clinic-1');

    const query = sqls[0] ?? '';
    expect(query).not.toContain('*');
    expect(query).not.toContain('api_key');
    expect(query).toContain(
      'SELECT provider, account_name, key_version, active, accept_new_charges',
    );
  });

  it('lê pelo caminho tenant (RLS), não por dbAdmin', async () => {
    stubTenantRead([]);

    await getPaymentAccountStatus('clinic-42');

    expect(withTenantMock).toHaveBeenCalledTimes(1);
    expect(withTenantMock.mock.calls[0]?.[0]).toBe('clinic-42');
  });

  it('sem linha, devolve o estado vazio (não "conectada")', async () => {
    stubTenantRead([]);

    await expect(getPaymentAccountStatus('clinic-1')).resolves.toEqual(EMPTY_PAYMENT_ACCOUNT);
  });

  it('deriva hasApiKey de `active` — a invariante do CHECK da 0081', async () => {
    stubTenantRead([
      {
        provider: 'asaas',
        account_name: 'Clínica Exemplo',
        key_version: 3,
        active: true,
        accept_new_charges: true,
        connected_at: '2026-08-24T00:00:00.000Z',
        webhook_configured_at: '2026-08-24T00:00:00.000Z',
      },
    ]);

    await expect(getPaymentAccountStatus('clinic-1')).resolves.toEqual({
      provider: 'asaas',
      hasApiKey: true,
      acceptNewCharges: true,
      webhookConfigured: true,
      accountName: 'Clínica Exemplo',
      keyVersion: 3,
      connectedAt: '2026-08-24T00:00:00.000Z',
      openLinks: 0,
      closure: null,
    });
  });

  it('conta desativada não conta como conectada', async () => {
    stubTenantRead([
      {
        provider: 'asaas',
        account_name: 'Clínica Exemplo',
        key_version: 3,
        active: false,
        accept_new_charges: false,
        connected_at: null,
        webhook_configured_at: null,
      },
    ]);

    const status = await getPaymentAccountStatus('clinic-1');
    expect(status.hasApiKey).toBe(false);
    expect(status).toMatchObject({ openLinks: 0, closure: null });
    expect(closureStateMock).not.toHaveBeenCalled();
  });

  it('conta conectada informa links abertos, sem oferecer encerramento', async () => {
    stubTenantRead([
      {
        provider: 'asaas',
        account_name: null,
        key_version: 1,
        active: true,
        accept_new_charges: true,
        connected_at: '2026-08-24T00:00:00.000Z',
        webhook_configured_at: '2026-08-24T00:00:00.000Z',
      },
    ]);
    closureStateMock.mockResolvedValue({
      active: true,
      paused: false,
      blockers: { openLinks: 3, pendingRefunds: 0, openDisputes: 0 },
      lastActivityAt: new Date('2026-10-07T12:00:00.000Z'),
      noticeSentAt: null,
    });

    const status = await getPaymentAccountStatus('clinic-1');
    expect(status).toMatchObject({ openLinks: 3, closure: null });
    expect(closureStateMock).toHaveBeenCalledWith('clinic-1');
  });

  it('conta pausada traz o que impede o encerramento e a previsão automática', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
    try {
      stubTenantRead([
        {
          provider: 'asaas',
          account_name: null,
          key_version: 1,
          active: true,
          accept_new_charges: false,
          connected_at: '2026-08-24T00:00:00.000Z',
          webhook_configured_at: '2026-08-24T00:00:00.000Z',
        },
      ]);
      closureStateMock.mockResolvedValue({
        active: true,
        paused: true,
        blockers: { openLinks: 1, pendingRefunds: 1, openDisputes: 0 },
        lastActivityAt: new Date('2026-10-07T12:00:00.000Z'),
        // Aviso ANTERIOR à última movimentação não vale e não aparece.
        noticeSentAt: new Date('2026-09-01T12:00:00.000Z'),
      });

      const status = await getPaymentAccountStatus('clinic-1');
      expect(status.openLinks).toBe(1);
      expect(status.closure).toEqual({
        blockers: { openLinks: 1, pendingRefunds: 1, openDisputes: 0 },
        canClose: false,
        lastActivityAt: '2026-10-07T12:00:00.000Z',
        autoCloseAt: '2027-04-05T12:00:00.000Z',
        noticeSentAt: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('conta pausada mantém integração para conciliar e bloqueia novas cobranças', async () => {
    stubTenantRead([
      {
        provider: 'asaas',
        account_name: 'Clínica Exemplo',
        key_version: 3,
        active: true,
        accept_new_charges: false,
        connected_at: '2026-08-24T00:00:00.000Z',
        webhook_configured_at: '2026-08-24T00:00:00.000Z',
      },
    ]);

    const status = await getPaymentAccountStatus('clinic-1');
    expect(status.hasApiKey).toBe(true);
    expect(status.acceptNewCharges).toBe(false);
    expect(status.webhookConfigured).toBe(true);
  });
});

describe('getDepositPolicy', () => {
  it('clínica sem linha devolve a política DESLIGADA — é o estado de hoje, não erro', async () => {
    stubTenantRead([]);

    await expect(getDepositPolicy('clinic-1')).resolves.toEqual({
      ...DEPOSIT_POLICY_OFF,
      updatedAt: null,
    });
  });

  it('mapeia as colunas da política configurada', async () => {
    stubTenantRead([
      {
        enabled: true,
        percent: 40,
        cancellation_window_hours: 48,
        applies_to_first_visit: true,
        applies_to_return: false,
        updated_at: '2026-08-24T10:00:00.000Z',
      },
    ]);

    await expect(getDepositPolicy('clinic-1')).resolves.toEqual({
      enabled: true,
      percent: 40,
      cancellationWindowHours: 48,
      appliesToFirstVisit: true,
      appliesToReturn: false,
      updatedAt: '2026-08-24T10:00:00.000Z',
    });
  });

  it('lê pelo caminho tenant e sem SELECT *', async () => {
    const { sqls } = stubTenantRead([]);

    await getDepositPolicy('clinic-9');

    expect(withTenantMock.mock.calls[0]?.[0]).toBe('clinic-9');
    expect(sqls[0] ?? '').not.toContain('*');
  });
});

describe('estado do webhook', () => {
  it('conta conectada sem webhook confirmado é o estado que a tela precisa gritar', async () => {
    stubTenantRead([
      {
        provider: 'asaas',
        account_name: 'Clínica Exemplo',
        key_version: 1,
        active: true,
        accept_new_charges: true,
        connected_at: '2026-08-24T00:00:00.000Z',
        webhook_configured_at: null,
      },
    ]);

    const status = await getPaymentAccountStatus('clinic-1');
    expect(status.hasApiKey).toBe(true);
    expect(status.webhookConfigured).toBe(false);
  });
});
