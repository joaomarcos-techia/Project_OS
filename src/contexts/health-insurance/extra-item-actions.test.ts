/**
 * P8.4 / P8.4-r — ações dos itens executados adicionais: permissão de cada papel (matriz I.2 e a
 * exceção do médico) antes de tudo, validação em português, regra do serviço como mensagem,
 * auditoria na mesma transação; incluir e aprovar sem o item com a permissão FRESCA de faturar.
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
  assertOwnSessionTx: vi.fn(),
  regularizeExtraItemTx: vi.fn(),
  includeExtraItemTx: vi.fn(),
  excludeExtraItemTx: vi.fn(),
  approveConsultaGuide: vi.fn(),
  getAppointmentExtraItems: vi.fn(),
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
vi.mock('./internal/guide-issuance', () => ({ approveConsultaGuide: m.approveConsultaGuide }));
vi.mock('./queries', () => ({ getAppointmentExtraItems: m.getAppointmentExtraItems }));
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
  return {
    ExtraItemRuleError,
    recordExtraItemTx: m.recordExtraItemTx,
    cancelExtraItemTx: m.cancelExtraItemTx,
    assertOwnSessionTx: m.assertOwnSessionTx,
    regularizeExtraItemTx: m.regularizeExtraItemTx,
    includeExtraItemTx: m.includeExtraItemTx,
    excludeExtraItemTx: m.excludeExtraItemTx,
  };
});

import { AuthError } from '@/lib/auth/tenant-context';
import { PERMISSIONS } from '@/lib/auth/permissions';

import {
  approveGuideWithoutPendingExtraItemsAction,
  cancelExtraItemAction,
  loadSessionExtraItemsAction,
  excludeExtraItemAction,
  includeExtraItemAction,
  recordExtraItemAction,
  recordOwnSessionExtraItemAction,
  regularizeExtraItemAction,
} from './actions';
import { ExtraItemRuleError } from './internal/extra-executed-items';
import { CONVENIOS_RULES } from './rights';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const GUIDE = '22222222-2222-4222-8222-222222222222';
const APPOINTMENT = '44444444-4444-4444-8444-444444444444';
const LINE = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const input = { appointmentId: APPOINTMENT, contractLineId: LINE, quantity: 2 };
const denied = () => new (AuthError as unknown as new (msg: string, code: string) => Error)('negado', 'forbidden');

describe('itens executados adicionais (P8.4-r): ações', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue({ userId: 'u1', isSuperAdmin: false, permissions: ['view:convenios', 'operate:convenios'] });
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireFreshPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.recordExtraItemTx.mockResolvedValue({ id: ITEM, existing: false });
    m.cancelExtraItemTx.mockResolvedValue(undefined);
    m.assertOwnSessionTx.mockResolvedValue(undefined);
    m.regularizeExtraItemTx.mockResolvedValue({ authorizationItemId: 'ai' });
    m.includeExtraItemTx.mockResolvedValue({ guideId: GUIDE, guideItemId: 'gi', existing: false });
    m.excludeExtraItemTx.mockResolvedValue(undefined);
    m.approveConsultaGuide.mockResolvedValue({});
  });

  it('registrar na conferência exige quem confere e grava a auditoria na transação, com a pessoa da sessão', async () => {
    expect(await recordExtraItemAction(input)).toEqual({ ok: true, data: ITEM });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.operateOrBill);
    expect(m.recordExtraItemTx).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      contractLineId: LINE,
      quantity: 2,
      source: 'conferencia',
      actorUserId: 'u1',
    });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'health_insurance.extra_item.recorded', resourceType: 'hi_appointment_extra_item', resourceId: ITEM }),
    );
  });

  it('sem a permissão de quem confere, nada chega ao serviço nem à auditoria', async () => {
    m.requireCachedAnyPermission.mockRejectedValueOnce(denied());
    expect(await recordExtraItemAction(input)).toEqual({ ok: false, error: 'Seu perfil não tem permissão para esta operação de convênios.' });
    expect(m.recordExtraItemTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('quantidade fora de 1 a 999: mensagem em português, sem chegar ao serviço', async () => {
    for (const quantity of [0, 1000, 1.5]) {
      expect(await recordExtraItemAction({ ...input, quantity })).toEqual({ ok: false, error: 'A quantidade precisa ser um número inteiro de 1 a 999.' });
      expect(await recordOwnSessionExtraItemAction({ ...input, quantity })).toEqual({ ok: false, error: 'A quantidade precisa ser um número inteiro de 1 a 999.' });
    }
    expect(m.recordExtraItemTx).not.toHaveBeenCalled();
  });

  it('exceção do médico: só a regra de entrada no módulo + posse da sessão conferida ANTES de registrar, origem consultório', async () => {
    m.requireUser.mockResolvedValue({ userId: 'doc', isSuperAdmin: false, permissions: ['view:convenios'] });
    expect(await recordOwnSessionExtraItemAction(input)).toEqual({ ok: true, data: ITEM });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.ownSession);
    expect(CONVENIOS_RULES.ownSession).toEqual([PERMISSIONS.VIEW_CONVENIOS]);
    expect(m.assertOwnSessionTx).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC, appointmentId: APPOINTMENT, userId: 'doc' });
    expect(m.assertOwnSessionTx.mock.invocationCallOrder[0]).toBeLessThan(m.recordExtraItemTx.mock.invocationCallOrder[0]!);
    expect(m.recordExtraItemTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: 'consultorio', actorUserId: 'doc' }));
    expect(m.logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'health_insurance.extra_item.recorded_own_session' }));
  });

  it('exceção do médico: sessão de outro profissional é recusada e nada é gravado nem auditado', async () => {
    m.assertOwnSessionTx.mockRejectedValueOnce(new ExtraItemRuleError('NOT_OWN_SESSION', 'Só o profissional desta sessão registra itens pelo consultório.'));
    expect(await recordOwnSessionExtraItemAction(input)).toEqual({ ok: false, error: 'Só o profissional desta sessão registra itens pelo consultório.' });
    expect(m.recordExtraItemTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('ligar a autorização é de quem confere (recepção ou faturamento)', async () => {
    expect(await regularizeExtraItemAction({ itemId: ITEM })).toEqual({ ok: true, data: null });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.operateOrBill);
    expect(m.logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'health_insurance.extra_item.regularized', resourceId: ITEM }));
  });

  it('incluir na guia é do faturamento, com permissão FRESCA, e leva a confirmação do contrato ao serviço', async () => {
    expect(await includeExtraItemAction({ itemId: ITEM, insurerRuleConfirmed: true })).toEqual({ ok: true, data: null });
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.bill);
    expect(m.includeExtraItemTx).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC, itemId: ITEM, actorUserId: 'u1', insurerRuleConfirmed: true });
    expect(m.logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'health_insurance.extra_item.included', resourceId: ITEM }));
  });

  it('incluir sem a permissão fresca de faturar não chega ao serviço', async () => {
    m.requireFreshPermission.mockRejectedValueOnce(denied());
    expect((await includeExtraItemAction({ itemId: ITEM })).ok).toBe(false);
    expect(m.includeExtraItemTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('não faturar é do faturamento e exige motivo de 10 a 300 caracteres', async () => {
    expect(await excludeExtraItemAction({ itemId: ITEM, reason: 'curto' })).toEqual({ ok: false, error: 'Explique o motivo de não faturar (10 a 300 caracteres).' });
    expect(m.excludeExtraItemTx).not.toHaveBeenCalled();
    expect(await excludeExtraItemAction({ itemId: ITEM, reason: 'Operadora recusou a regularização' })).toEqual({ ok: true, data: null });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.bill);
    expect(m.excludeExtraItemTx).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC, itemId: ITEM, reason: 'Operadora recusou a regularização' });
    expect(m.logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'health_insurance.extra_item.excluded' }));
  });

  it('aprovar sem os pendentes: faturamento, permissão fresca, motivo obrigatório, numa emissão só', async () => {
    expect(await approveGuideWithoutPendingExtraItemsAction({ guideId: GUIDE, reason: 'x' })).toEqual({
      ok: false,
      error: 'Explique por que os itens não serão faturados (10 a 300 caracteres).',
    });
    expect(m.approveConsultaGuide).not.toHaveBeenCalled();
    expect(await approveGuideWithoutPendingExtraItemsAction({ guideId: GUIDE, reason: 'Sem autorização da operadora' })).toEqual({ ok: true, data: null });
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    expect(m.approveConsultaGuide).toHaveBeenCalledWith(CLINIC, GUIDE, { withoutPendingExtraItems: { reason: 'Sem autorização da operadora' } });
  });

  it('a regra do serviço volta como está, sem detalhe técnico', async () => {
    m.includeExtraItemTx.mockRejectedValueOnce(new ExtraItemRuleError('INSURER_CONFIRMATION_REQUIRED', 'A regra desta operadora para item além do solicitado não está registrada. Confirme que o contrato permite antes de incluir.'));
    expect(await includeExtraItemAction({ itemId: ITEM })).toEqual({
      ok: false,
      error: 'A regra desta operadora para item além do solicitado não está registrada. Confirme que o contrato permite antes de incluir.',
    });
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('leitura do consultório: regra de entrada no módulo; sem visão ampla, a posse é do servidor (broad=false)', async () => {
    m.getAppointmentExtraItems.mockResolvedValue(null);
    m.requireUser.mockResolvedValue({ userId: 'doc', isSuperAdmin: false, permissions: ['view:convenios'] });
    expect(await loadSessionExtraItemsAction({ appointmentId: APPOINTMENT })).toEqual({ ok: true, data: null });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(CONVENIOS_RULES.ownSession);
    expect(m.getAppointmentExtraItems).toHaveBeenCalledWith(CLINIC, APPOINTMENT, { userId: 'doc', broad: false });
    m.requireUser.mockResolvedValue({ userId: 'rec', isSuperAdmin: false, permissions: ['view:convenios', 'operate:convenios'] });
    await loadSessionExtraItemsAction({ appointmentId: APPOINTMENT });
    expect(m.getAppointmentExtraItems).toHaveBeenLastCalledWith(CLINIC, APPOINTMENT, { userId: 'rec', broad: true });
    expect((await loadSessionExtraItemsAction({ appointmentId: 'x' })).ok).toBe(false);
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('cancelar o registro exige motivo e audita com o id do item', async () => {
    expect(await cancelExtraItemAction({ itemId: ITEM, reason: 'x' })).toEqual({ ok: false, error: 'Explique o motivo do cancelamento (3 a 300 caracteres).' });
    expect(m.cancelExtraItemTx).not.toHaveBeenCalled();
    expect(await cancelExtraItemAction({ itemId: ITEM, reason: 'Registrado na sessão errada' })).toEqual({ ok: true, data: null });
    expect(m.cancelExtraItemTx).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC, itemId: ITEM, reason: 'Registrado na sessão errada' });
    expect(m.logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'health_insurance.extra_item.cancelled', resourceId: ITEM }));
  });
});
