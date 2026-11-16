import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSuperAdmin, requireUser, transaction, emit } = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  requireUser: vi.fn(),
  transaction: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/auth/tenant-context', () => ({ requireSuperAdmin, requireUser }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));

import { superAdminActions } from '@/lib/db/schema/infra/super-admin';

import { superAdminAuditedRead } from './super-admin';

const values = vi.fn();
const insert = vi.fn(() => ({ values }));
const tx = { insert };

const clinicId = '11111111-1111-4111-8111-111111111111';
const requestContext = { ip: '203.0.113.7', userAgent: 'vitest', requestId: 'req-1' };

function read<T>(fn: () => Promise<T | null>, payload: (r: T) => Record<string, unknown>) {
  return superAdminAuditedRead(
    { action: 'test.read', targetClinicId: clinicId, requestContext, payload },
    async () => fn(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdmin.mockResolvedValue(undefined);
  requireUser.mockResolvedValue({ userId: 'admin-1' });
  transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
  values.mockResolvedValue(undefined);
});

describe('superAdminAuditedRead — leitura sensível com trilha fail-closed (S-01)', () => {
  it('grava o evento DEPOIS da leitura, na mesma transação, com o ator da sessão', async () => {
    const order: string[] = [];
    values.mockImplementation(async () => {
      order.push('audit');
    });

    const result = await read(
      async () => {
        order.push('read');
        return { n: 3 };
      },
      (r) => ({ count: r.n }),
    );

    expect(result).toEqual({ n: 3 });
    expect(order).toEqual(['read', 'audit']);
    expect(transaction).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(superAdminActions);
    expect(values).toHaveBeenCalledWith({
      superAdminId: 'admin-1',
      action: 'test.read',
      targetClinicId: clinicId,
      payload: { count: 3 },
      ipAddress: '203.0.113.7',
      userAgent: 'vitest',
    });
    expect(emit).toHaveBeenCalledWith('super_admin.action', {
      action: 'test.read',
      targetClinicId: clinicId,
    });
  });

  it('null não grava nada: a trilha registra leitura que aconteceu, não tentativa', async () => {
    const payload = vi.fn(() => ({}));

    await expect(read(async () => null, payload)).resolves.toBeNull();

    expect(payload).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('fail-closed: INSERT que falha derruba a leitura e o resultado não sai', async () => {
    values.mockRejectedValue(new Error('insert failed'));

    await expect(
      read(
        async () => ({ text: 'texto' }),
        () => ({}),
      ),
    ).rejects.toThrow('insert failed');
    expect(emit).not.toHaveBeenCalled();
  });

  it('o payload passa pelo sanitizador: chave sensível não entra em claro', async () => {
    await read(
      async () => ({ ok: true }),
      () => ({ content: 'texto do paciente', conversationId: 'conv-1' }),
    );

    expect(values.mock.calls[0]?.[0]).toMatchObject({
      payload: { content: '[REDACTED]', conversationId: 'conv-1' },
    });
  });

  it('sem super_admin AAL2 não abre transação nem lê', async () => {
    requireSuperAdmin.mockRejectedValue(new Error('MFA_REQUIRED'));
    const fn = vi.fn(async () => ({ n: 1 }));

    await expect(read(fn, () => ({}))).rejects.toThrow('MFA_REQUIRED');

    expect(fn).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
