/**
 * P8.4 — ações dos itens executados adicionais na conferência: permissão de quem confere
 * (recepção ou faturamento, matriz I.2) antes de tudo, validação em português, regra do serviço
 * como mensagem, e auditoria na mesma transação.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireCachedAnyPermission: vi.fn(),
  requireFreshPermission: vi.fn(),
  requireClinicId: vi.fn(),
  logAudit: vi.fn(),
  execute: vi.fn(),
  revalidatePath: vi.fn(),
  recordExtraItemTx: vi.fn(),
  cancelExtraItemTx: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/auth/tenant-context', async () => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly httpStatus?: number,
      readonly reason?: string,
    ) {
      super(message);
    }
  }
  return {
    AuthError,
    requireUser: m.requireUser,
    requireCachedPermission: m.requireCachedPermission,
    requireCachedAnyPermission: m.requireCachedAnyPermission,
    requireFreshPermission: m.requireFreshPermission,
    requireClinicId: m.requireClinicId,
  };
});
vi.mock('@/lib/audit/log', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext: async () => ({ ip: null, userAgent: null, requestId: 'r1' }) }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: async (_c: string, fn: (tx: unknown) => unknown) => fn({ execute: m.execute }) }));
vi.mock('@/lib/storage/tiss-files', () => ({ supabaseTissObjectStore: () => ({}), TissStorageError: class extends Error {} }));
vi.mock('./tiss/xml/xsd-validator', () => ({ loadXmllintValidator: () => null }));
vi.mock('./internal/extra-executed-items', () => {
  class ExtraItemRuleError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'ExtraItemRuleError';
    }
  }
  return { ExtraItemRuleError, recordExtraItemTx: m.recordExtraItemTx, cancelExtraItemTx: m.cancelExtraItemTx };
});

import { AuthError } from '@/lib/auth/tenant-context';

import { cancelExtraItemAction, recordExtraItemAction } from './actions';
import { ExtraItemRuleError } from './internal/extra-executed-items';
import { CONVENIOS_RULES } from './rights';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const APPOINTMENT = '44444444-4444-4444-8444-444444444444';
const LINE = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const input = { appointmentId: APPOINTMENT, contractLineId: LINE, quantity: 2 };

describe('itens executados adicionais (P8.4): ações da conferência', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue({ userId: 'u1', isSuperAdmin: false, permissions: ['view:convenios', 'operate:convenios'] });
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.recordExtraItemTx.mockResolvedValue({ id: ITEM });
    m.cancelExtraItemTx.mockResolvedValue(undefined);
  });

  it('registrar exige quem confere (recepção ou faturamento) e grava a auditoria na transação', async () => {
    expect(await recordExtraItemAction(input)).toEqual({ ok: true, data: ITEM });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.operateOrBill);
    expect(m.recordExtraItemTx).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      contractLineId: LINE,
      quantity: 2,
      source: 'conferencia',
    });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'health_insurance.extra_item.recorded', resourceType: 'hi_appointment_extra_item', resourceId: ITEM }),
    );
  });

  it('sem a permissão de quem confere, nada chega ao serviço nem à auditoria', async () => {
    m.requireCachedAnyPermission.mockRejectedValueOnce(new (AuthError as unknown as new (msg: string, code: string) => Error)('negado', 'forbidden'));
    expect(await recordExtraItemAction(input)).toEqual({ ok: false, error: 'Seu perfil não tem permissão para esta operação de convênios.' });
    expect(m.recordExtraItemTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('quantidade fora de 1 a 999: mensagem em português, sem chegar ao serviço', async () => {
    for (const quantity of [0, 1000, 1.5]) {
      expect(await recordExtraItemAction({ ...input, quantity })).toEqual({
        ok: false,
        error: 'A quantidade precisa ser um número inteiro de 1 a 999.',
      });
    }
    expect(m.recordExtraItemTx).not.toHaveBeenCalled();
  });

  it('a regra do serviço (ex.: guia já conferida) volta como está, sem detalhe técnico', async () => {
    m.recordExtraItemTx.mockRejectedValueOnce(new ExtraItemRuleError('GUIDE_CLOSED', 'A guia desta sessão já foi fechada. Reabra ou substitua a guia para mudar os itens.'));
    expect(await recordExtraItemAction(input)).toEqual({
      ok: false,
      error: 'A guia desta sessão já foi fechada. Reabra ou substitua a guia para mudar os itens.',
    });
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('cancelar exige motivo e audita com o id do item', async () => {
    expect(await cancelExtraItemAction({ itemId: ITEM, reason: 'x' })).toEqual({
      ok: false,
      error: 'Explique o motivo do cancelamento (3 a 300 caracteres).',
    });
    expect(m.cancelExtraItemTx).not.toHaveBeenCalled();
    expect(await cancelExtraItemAction({ itemId: ITEM, reason: 'Registrado na sessão errada' })).toEqual({ ok: true, data: null });
    expect(m.cancelExtraItemTx).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC, itemId: ITEM, reason: 'Registrado na sessão errada' });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'health_insurance.extra_item.cancelled', resourceId: ITEM }),
    );
  });
});
