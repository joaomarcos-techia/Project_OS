/**
 * Ações da interface de Convênios: permissão antes de tudo, validação, auditoria na mesma
 * transação, e mensagens para o usuário sem detalhe técnico.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireCachedAnyPermission: vi.fn(),
  requireFreshPermission: vi.fn(),
  requireClinicId: vi.fn(),
  decidePayoutReviewTx: vi.fn(),
  attachAuthorizationReceipt: vi.fn(),
  beginReceiptUpload: vi.fn(),
  openReceiptUpload: vi.fn(),
  putReceiptChunk: vi.fn(),
  assembleReceiptUpload: vi.fn(),
  discardReceiptUpload: vi.fn(),
  setPayoutReviewPolicyTx: vi.fn(),
  logAudit: vi.fn(),
  execute: vi.fn(),
  createBatchInTx: vi.fn(),
  transitionGlossInTx: vi.fn(),
  recordPaymentInTx: vi.fn(),
  revalidatePath: vi.fn(),
  approveConsultaGuide: vi.fn(),
  updateConsultaOverridesInTx: vi.fn(),
  setClinicalIndicationInTx: vi.fn(),
  recordManualAuthorizationResponseTx: vi.fn(),
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
vi.mock('./internal/payout-review-service', () => {
  class PayoutReviewError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
      this.name = 'PayoutReviewError';
    }
  }
  return { PayoutReviewError, decidePayoutReviewTx: m.decidePayoutReviewTx, setPayoutReviewPolicyTx: m.setPayoutReviewPolicyTx };
});
vi.mock('./internal/batch-service', () => ({ createBatchInTx: m.createBatchInTx, BatchExportError: class extends Error {} }));
vi.mock('./internal/guide-access', () => ({ readBatchGuidesAudited: vi.fn() }));
vi.mock('./internal/guide-issuance', () => ({ approveConsultaGuide: m.approveConsultaGuide }));
vi.mock('./internal/consulta-overrides-service', () => {
  class ConsultaOverridesError extends Error {
    constructor(message: string, readonly kind: string) {
      super(message);
      this.name = 'ConsultaOverridesError';
    }
  }
  return { ConsultaOverridesError, updateConsultaOverridesInTx: m.updateConsultaOverridesInTx };
});
vi.mock('./internal/insurance-account-service', () => {
  class InsuranceAccountError extends Error {
    constructor(message: string, readonly kind: string) {
      super(message);
    }
  }
  return { InsuranceAccountError, transitionGlossInTx: m.transitionGlossInTx, recordPaymentInTx: m.recordPaymentInTx };
});
vi.mock('./internal/authorizations', () => {
  class AuthorizationError extends Error {
    constructor(message: string, readonly kind: string) {
      super(message);
      this.name = 'AuthorizationError';
    }
  }
  return { AuthorizationError, recordManualAuthorizationResponseTx: m.recordManualAuthorizationResponseTx, attachAuthorizationReceipt: m.attachAuthorizationReceipt };
});
vi.mock('./internal/receipt-upload', () => {
  class ReceiptUploadError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
      this.name = 'ReceiptUploadError';
    }
  }
  return {
    ReceiptUploadError,
    beginReceiptUpload: m.beginReceiptUpload,
    openReceiptUpload: m.openReceiptUpload,
    putReceiptChunk: m.putReceiptChunk,
    assembleReceiptUpload: m.assembleReceiptUpload,
    discardReceiptUpload: m.discardReceiptUpload,
  };
});
vi.mock('./tiss/xml/xsd-validator', () => ({ loadXmllintValidator: () => null }));
vi.mock('./internal/sadt-request-service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setClinicalIndicationInTx: m.setClinicalIndicationInTx,
}));

import { AuthError } from '@/lib/auth/tenant-context';
import { PremiumAccessError } from '@/lib/premium-access';

import {
  approveGuideAction,
  createBatchAction,
  beginAuthorizationReceiptUploadAction,
  decideGlossAction,
  finishAuthorizationReceiptUploadAction,
  uploadAuthorizationReceiptChunkAction,
  decidePayoutReviewAction,
  recordConsultaAuthorizationResponseAction,
  recordPaymentAction,
  returnGuideAction,
  reviewGuideAction,
  setPayoutReviewPolicyAction,
  setSadtClinicalIndicationAction,
  updateConsultaFieldsAction,
} from './actions';
import { AuthorizationError } from './internal/authorizations';
import { ConsultaOverridesError } from './internal/consulta-overrides-service';
import { ConveniosModuleDisabledError } from './internal/module-guard';
import { PayoutReviewError } from './internal/payout-review-service';
import { notReviewedError } from './internal/issuance-common';

/** Erro com o mesmo nome do da emissão (a ação reconhece pelo nome, como o BatchRuleError). */
const issuanceError = (message: string, issues: Array<{ message: string }> = []) =>
  Object.assign(new Error(message), { name: 'GuideIssuanceError', issues });

const CLINIC = '11111111-1111-4111-8111-111111111111';
/** Sessão padrão dos testes: entra, opera e fatura (visão ampla). */
const SESSION = { userId: 'u1', isSuperAdmin: false, permissions: ['view:convenios', 'operate:convenios', 'view:faturamento_convenio', 'manage:faturamento_convenio'] };
const GUIDE = '22222222-2222-4222-8222-222222222222';
const INSURER = '33333333-3333-4333-8333-333333333333';

describe('ações de Convênios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue(SESSION);
    m.requireCachedPermission.mockResolvedValue(undefined);
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireFreshPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
  });

  it('exige faturar (manage:faturamento_convenio, matriz I.2) antes de qualquer acesso ao banco', async () => {
    m.requireCachedAnyPermission.mockRejectedValueOnce(new (AuthError as unknown as new (msg: string, code: string) => Error)('negado', 'forbidden'));
    const r = await createBatchAction({ insurerId: INSURER, guideIds: [GUIDE], idempotencyKey: 'chave-123456' });
    expect(r).toEqual({ ok: false, error: 'Seu perfil não tem permissão para esta operação de convênios.' });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(['manage:faturamento_convenio']);
    expect(m.createBatchInTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('sessão terminada, acesso desativado e conta removida têm mensagens distintas e não chegam ao banco', async () => {
    type Ctor = new (msg: string, code: string, status: number, reason: string) => Error;
    const Err = AuthError as unknown as Ctor;
    const input = { guideId: GUIDE, version: 1, tipoConsulta: '4' };
    m.requireUser.mockRejectedValueOnce(new Err('Autenticação necessária', 'unauthenticated', 401, 'TOKEN_INVALID'));
    expect(await updateConsultaFieldsAction(input)).toEqual({ ok: false, error: 'Sua sessão terminou. Entre de novo para continuar.' });
    m.requireUser.mockRejectedValueOnce(new Err('Acesso desativado.', 'unauthenticated', 401, 'USER_DISABLED'));
    expect(await updateConsultaFieldsAction(input)).toEqual({
      ok: false,
      error: 'Seu acesso a esta clínica foi desativado. Fale com o administrador da clínica.',
    });
    m.requireUser.mockRejectedValueOnce(new Err('Conta removida.', 'unauthenticated', 401, 'USER_DELETED'));
    expect((await updateConsultaFieldsAction(input)).ok).toBe(false);
    expect(m.updateConsultaOverridesInTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('código adulterado nos dados da consulta: mensagem em português, sem chegar ao serviço', async () => {
    const r = await updateConsultaFieldsAction({ guideId: GUIDE, version: 1, tipoConsulta: '44' });
    expect(r).toEqual({
      ok: false,
      error: 'Tipo de consulta: código fora da terminologia da ANS. Escolha uma opção da lista.',
    });
    expect(m.updateConsultaOverridesInTx).not.toHaveBeenCalled();
  });

  it('valida a entrada (UUID, motivo) antes de chamar o serviço', async () => {
    const bad = await createBatchAction({ insurerId: 'x', guideIds: [], idempotencyKey: 'k' });
    expect(bad.ok).toBe(false);
    const noReason = await decideGlossAction({ glossId: GUIDE, version: 1, to: 'definitive' });
    expect(noReason).toEqual({ ok: false, error: 'Informe o motivo (10 a 500 caracteres).' });
    expect(m.transitionGlossInTx).not.toHaveBeenCalled();
  });

  it('cria o lote com a pessoa da sessão, chave prefixada e auditoria na mesma transação', async () => {
    m.createBatchInTx.mockResolvedValueOnce('lote-1');
    const r = await createBatchAction({ insurerId: INSURER, guideIds: [GUIDE], idempotencyKey: 'chave-123456' });
    expect(r).toEqual({ ok: true, data: 'lote-1' });
    expect(m.createBatchInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clinicId: CLINIC, idempotencyKey: 'ui:chave-123456' }));
    expect(m.logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clinicId: CLINIC, userId: 'u1', action: 'health_insurance.batch.created', resourceId: 'lote-1' }));
    expect(m.revalidatePath).toHaveBeenCalledWith('/convenios', 'layout');
  });

  it('regra do banco vira a mensagem do banco; erro desconhecido vira mensagem genérica (sem detalhe técnico)', async () => {
    m.transitionGlossInTx.mockRejectedValueOnce({ cause: { code: '55000', message: 'Glosa decidida não volta.' } });
    expect(await decideGlossAction({ glossId: GUIDE, version: 1, to: 'contested' })).toEqual({ ok: false, error: 'Glosa decidida não volta.' });
    m.recordPaymentInTx.mockRejectedValueOnce(new Error('connection refused 10.0.0.1:5432'));
    const r = await recordPaymentAction({ insurerId: INSURER, paidOn: '2026-11-12', amountCents: 100, idempotencyKey: 'chave-123456' });
    expect(r).toEqual({ ok: false, error: 'Não foi possível concluir agora. Tente de novo; se persistir, fale com o suporte.' });
  });

  it('conferência com versão desatualizada é recusada (outra pessoa mexeu na guia)', async () => {
    // 1º: decisão comercial (liberado); 2º: módulo ligado; 3º: o UPDATE com a versão antiga não acha a linha.
    m.execute
      .mockResolvedValueOnce([{ denial: null }])
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([]);
    const r = await reviewGuideAction({ guideId: GUIDE, version: 3 });
    expect(r).toEqual({ ok: false, error: 'A guia mudou desde que a tela foi aberta. Atualize e confira de novo.' });
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('D24: conferir e devolver são recusados em trial e com a clínica suspensa, antes de tocar a guia', async () => {
    for (const denial of ['trial', 'clinic_suspended']) {
      m.execute.mockReset();
      m.execute.mockResolvedValueOnce([{ denial }]);
      const reviewed = await reviewGuideAction({ guideId: GUIDE, version: 3 });
      expect(reviewed.ok).toBe(false);
      expect(reviewed.ok ? '' : reviewed.error).toMatch(
        denial === 'trial' ? /^Convênios: este recurso está disponível para clínicas com assinatura ativa/u : /^Convênios: a assinatura da clínica não está ativa/u,
      );
      expect(m.execute).toHaveBeenCalledTimes(1);
      m.execute.mockResolvedValueOnce([{ denial }]);
      const returned = await returnGuideAction({ guideId: GUIDE, version: 3, note: 'Corrigir o tipo de consulta.' });
      expect(returned.ok).toBe(false);
      expect(m.execute).toHaveBeenCalledTimes(2);
    }
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('módulo desligado (assinatura ativa): conferir e devolver são recusados com a mensagem do módulo, sem tocar a guia', async () => {
    const MODULE_OFF = /^Convênios está desligado nesta clínica\./u;
    for (const settings of [[{ enabled: false }], []]) {
      // Sem linha de configuração = nunca ligado (desligado por padrão).
      m.execute.mockReset();
      m.execute.mockResolvedValueOnce([{ denial: null }]).mockResolvedValueOnce(settings);
      const reviewed = await reviewGuideAction({ guideId: GUIDE, version: 3 });
      expect(reviewed.ok ? '' : reviewed.error).toMatch(MODULE_OFF);
      expect(m.execute).toHaveBeenCalledTimes(2); // decisão comercial + interruptor; nenhum UPDATE
      m.execute.mockResolvedValueOnce([{ denial: null }]).mockResolvedValueOnce(settings);
      const returned = await returnGuideAction({ guideId: GUIDE, version: 3, note: 'Corrigir o tipo de consulta.' });
      expect(returned.ok ? '' : returned.error).toMatch(MODULE_OFF);
      expect(m.execute).toHaveBeenCalledTimes(4);
    }
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('aprovação concorrente: quem perde lê que a guia já foi aprovada (não "registro já existe" nem erro genérico)', async () => {
    m.approveConsultaGuide.mockRejectedValueOnce(
      issuanceError(notReviewedError('approved').message),
    );
    expect(await approveGuideAction({ guideId: GUIDE })).toEqual({
      ok: false,
      error:
        'Esta guia já foi aprovada e emitida (etapa: Aprovada). Atualize a página para ver a situação mais recente',
    });
    m.approveConsultaGuide.mockRejectedValueOnce(issuanceError(notReviewedError('ready_for_review').message));
    expect(await approveGuideAction({ guideId: GUIDE })).toEqual({
      ok: false,
      error:
        'Só se emite guia conferida (etapa: Para conferir). Atualize a página para ver a situação mais recente',
    });
  });

  it('emissão reprovada no validador mostra a primeira pendência', async () => {
    m.approveConsultaGuide.mockRejectedValueOnce(
      issuanceError('a guia não passa na validação TISS', [{ message: 'Tipo de consulta fora da tabela 52 da ANS.' }]),
    );
    expect(await approveGuideAction({ guideId: GUIDE })).toEqual({
      ok: false,
      error: 'A guia não passa na validação TISS: Tipo de consulta fora da tabela 52 da ANS.',
    });
  });

  it('ajuste dos dados da Consulta (D11): permissão, campos ao serviço, auditoria e versão nova', async () => {
    m.updateConsultaOverridesInTx.mockResolvedValueOnce({ version: 5, overrides: { tipoConsulta: '4' }, changed: true });
    const r = await updateConsultaFieldsAction({ guideId: GUIDE, version: 4, tipoConsulta: '4', regimeAtendimento: '', observacao: null });
    expect(r).toEqual({ ok: true, data: 5 });
    // Recepção ou faturamento corrigem a Consulta (matriz 4.2).
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(['operate:convenios', 'manage:faturamento_convenio']);
    expect(m.updateConsultaOverridesInTx).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC,
      guideId: GUIDE,
      version: 4,
      input: { tipoConsulta: '4', regimeAtendimento: '', observacao: null },
    });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'health_insurance.guide.consulta_fields_updated', resourceId: GUIDE, after: { result: 5 } }),
    );
  });

  it('ajuste recusado pelo serviço chega com a mensagem do serviço; entrada fora do formato nem chega a ele', async () => {
    m.updateConsultaOverridesInTx.mockRejectedValueOnce(
      new ConsultaOverridesError('Tipo de consulta: o código 7 não está na tabela 52 da ANS (terminologia 202609).', 'invalid'),
    );
    expect(await updateConsultaFieldsAction({ guideId: GUIDE, version: 4, tipoConsulta: '7' })).toEqual({
      ok: false,
      error: 'Tipo de consulta: o código 7 não está na tabela 52 da ANS (terminologia 202609).',
    });
    const long = await updateConsultaFieldsAction({ guideId: GUIDE, version: 4, observacao: 'a'.repeat(501) });
    expect(long).toEqual({ ok: false, error: 'Observação: até 500 caracteres (padrão TISS).' });
    expect(m.updateConsultaOverridesInTx).toHaveBeenCalledTimes(1);
  });
});

/**
 * Indicação clínica da SP/SADT: a única action com portão próprio (actions-gate.test.ts). Confere,
 * no servidor, sessão, acesso ativo, clínica da sessão, permissão pelo tipo do solicitante e, no
 * serviço, a situação comercial (D24, 15/11 noite) e a posse (só a solicitante interna; prova de
 * banco em health-insurance-sadt-db.ts, seção 11).
 */
describe('indicação clínica da SP/SADT (portão próprio)', () => {
  const REQ = '44444444-4444-4444-8444-444444444444';
  const input = { requestId: REQ, version: 2, text: 'Psicoterapia semanal.' };
  type Ctor = new (msg: string, code: string, status: number, reason: string) => Error;
  const Err = AuthError as unknown as Ctor;

  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue(SESSION);
    m.requireCachedPermission.mockResolvedValue(undefined);
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireFreshPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.setClinicalIndicationInTx.mockResolvedValue(3);
  });

  it('sessão terminada ou acesso desativado: mensagem própria, nada é lido nem gravado', async () => {
    m.requireUser.mockRejectedValueOnce(new Err('Autenticação necessária', 'unauthenticated', 401, 'TOKEN_INVALID'));
    expect(await setSadtClinicalIndicationAction(input)).toEqual({
      ok: false,
      error: 'Sua sessão terminou. Entre de novo para continuar.',
    });
    m.requireUser.mockRejectedValueOnce(new Err('Acesso desativado.', 'unauthenticated', 401, 'USER_DISABLED'));
    expect(await setSadtClinicalIndicationAction(input)).toEqual({
      ok: false,
      error: 'Seu acesso a esta clínica foi desativado. Fale com o administrador da clínica.',
    });
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.setClinicalIndicationInTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('solicitante interno exige a permissão clínica; externo, a da recepção; sem ela nada é gravado', async () => {
    m.execute.mockResolvedValueOnce([{ requester_kind: 'internal' }]);
    m.requireCachedPermission.mockResolvedValueOnce(undefined); // view:convenios
    m.requireCachedPermission.mockRejectedValueOnce(new Err('negado', 'forbidden', 403, 'PERMISSION_DENIED'));
    expect(await setSadtClinicalIndicationAction(input)).toEqual({
      ok: false,
      error: 'Seu perfil não tem permissão para esta operação de convênios.',
    });
    expect(m.requireCachedPermission).toHaveBeenLastCalledWith('create:prontuario');
    m.execute.mockResolvedValueOnce([{ requester_kind: 'external' }]);
    m.requireCachedPermission.mockResolvedValueOnce(undefined); // view:convenios
    m.requireCachedPermission.mockRejectedValueOnce(new Err('negado', 'forbidden', 403, 'PERMISSION_DENIED'));
    expect((await setSadtClinicalIndicationAction(input)).ok).toBe(false);
    expect(m.requireCachedPermission).toHaveBeenLastCalledWith('operate:convenios');
    expect(m.setClinicalIndicationInTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('solicitação de outra clínica (ou id adulterado): "inexistente nesta clínica", só depois de entrar em Convênios, sem gravar', async () => {
    m.execute.mockResolvedValueOnce([]);
    expect(await setSadtClinicalIndicationAction(input)).toEqual({
      ok: false,
      error: 'Solicitação inexistente nesta clínica.',
    });
    expect(m.requireCachedPermission).toHaveBeenCalledTimes(1);
    expect(m.requireCachedPermission).toHaveBeenCalledWith('view:convenios');
    expect(m.setClinicalIndicationInTx).not.toHaveBeenCalled();
  });

  it('sem operar Convênios (a médica): só a própria solicitação; a de outra profissional é "inexistente"', async () => {
    m.requireUser.mockResolvedValue({ userId: 'u1', isSuperAdmin: false, permissions: ['view:convenios', 'create:prontuario'] });
    m.execute.mockResolvedValueOnce([{ requester_kind: 'internal', requester: 'outra-pessoa' }]);
    expect(await setSadtClinicalIndicationAction(input)).toEqual({ ok: false, error: 'Solicitação inexistente nesta clínica.' });
    expect(m.setClinicalIndicationInTx).not.toHaveBeenCalled();
    m.execute.mockResolvedValueOnce([{ requester_kind: 'internal', requester: 'u1' }]);
    expect((await setSadtClinicalIndicationAction(input)).ok).toBe(true);
    expect(m.setClinicalIndicationInTx).toHaveBeenCalledTimes(1);
  });

  it('clínica suspensa ou em trial (recusa do serviço): mensagem comercial e nenhuma auditoria de sucesso', async () => {
    m.execute.mockResolvedValueOnce([{ requester_kind: 'internal' }]);
    m.setClinicalIndicationInTx.mockRejectedValueOnce(new PremiumAccessError('health_insurance', 'clinic_suspended'));
    const r = await setSadtClinicalIndicationAction(input);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.startsWith('Convênios:')).toBe(true);
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('autorizada: grava com a clínica e a pessoa da sessão (não as do pedido) e audita sem o texto', async () => {
    m.execute.mockResolvedValueOnce([{ requester_kind: 'internal' }]);
    expect(await setSadtClinicalIndicationAction(input)).toEqual({ ok: true, data: null });
    expect(m.setClinicalIndicationInTx).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC,
      requestId: REQ,
      version: 2,
      text: 'Psicoterapia semanal.',
      actorUserId: 'u1',
    });
    expect(m.logAudit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.logAudit.mock.calls[0])).not.toContain('Psicoterapia');
  });
});

describe('resposta da operadora à autorização da Consulta (P6.3)', () => {
  const AUTH = '55555555-5555-4555-8555-555555555555';
  const ITEM = '66666666-6666-4666-8666-666666666666';
  const authorized = {
    decision: 'authorized' as const,
    authorizationId: AUTH,
    version: 3,
    authorizedOn: '2026-11-15',
    operatorGuideNumber: ' 998877 ',
    operatorProtocol: '',
    password: 'S3NHA-OPERADORA',
    passwordValidUntil: '2026-12-15',
    items: [{ itemId: ITEM, quantityAuthorized: 1 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue(SESSION);
    m.requireCachedPermission.mockResolvedValue(undefined);
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireFreshPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.recordManualAuthorizationResponseTx.mockResolvedValue({ status: 'authorized' });
  });

  it('exige operar Convênios (recepção, matriz 4.2) antes do banco', async () => {
    m.requireCachedAnyPermission.mockRejectedValueOnce(new (AuthError as unknown as new (msg: string, code: string) => Error)('negado', 'forbidden'));
    const r = await recordConsultaAuthorizationResponseAction(authorized);
    expect(r).toEqual({ ok: false, error: 'Seu perfil não tem permissão para esta operação de convênios.' });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(['operate:convenios']);
    expect(m.recordManualAuthorizationResponseTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('autorizada: clínica e autor da sessão, campos vazios viram ausentes, auditoria só com o resultado (nunca a senha)', async () => {
    expect(await recordConsultaAuthorizationResponseAction(authorized)).toEqual({ ok: true, data: 'authorized' });
    expect(m.recordManualAuthorizationResponseTx).toHaveBeenCalledWith(expect.anything(), {
      decision: 'authorized',
      clinicId: CLINIC,
      authorizationId: AUTH,
      version: 3,
      authorizedOn: '2026-11-15',
      operatorGuideNumber: '998877',
      operatorProtocol: undefined,
      password: 'S3NHA-OPERADORA',
      passwordValidUntil: '2026-12-15',
      items: [{ itemId: ITEM, quantityAuthorized: 1 }],
      actorUserId: 'u1',
    });
    expect(m.logAudit).toHaveBeenCalledTimes(1);
    const audit = m.logAudit.mock.calls[0]![1] as { action: string; resourceId: string; after: unknown };
    expect([audit.action, audit.resourceId]).toEqual(['health_insurance.authorization.response_recorded', AUTH]);
    expect(audit.after).toEqual({ result: 'authorized' });
    expect(JSON.stringify(m.logAudit.mock.calls)).not.toContain('S3NHA');
  });

  it('negada: motivo obrigatório (mensagem em português, sem chegar ao serviço) e, com motivo, grava', async () => {
    const short = await recordConsultaAuthorizationResponseAction({ decision: 'denied', authorizationId: AUTH, version: 3, denialReason: ' x ' });
    expect(short).toEqual({ ok: false, error: 'Informe o motivo da negativa da operadora.' });
    expect(m.recordManualAuthorizationResponseTx).not.toHaveBeenCalled();
    m.recordManualAuthorizationResponseTx.mockResolvedValueOnce({ status: 'denied' });
    const ok = await recordConsultaAuthorizationResponseAction({ decision: 'denied', authorizationId: AUTH, version: 3, denialReason: 'Fora da cobertura do plano' });
    expect(ok).toEqual({ ok: true, data: 'denied' });
    expect(m.recordManualAuthorizationResponseTx).toHaveBeenCalledWith(expect.anything(), {
      decision: 'denied', clinicId: CLINIC, authorizationId: AUTH, version: 3, denialReason: 'Fora da cobertura do plano', actorUserId: 'u1',
    });
  });

  it('regra do serviço (evidência, versão, outra clínica) e módulo desligado: a mensagem do serviço, sem auditoria de sucesso', async () => {
    m.recordManualAuthorizationResponseTx.mockRejectedValueOnce(
      new AuthorizationError('Autorização só com evidência da operadora: número da guia na operadora, senha ou protocolo.', 'evidence_required'),
    );
    expect(await recordConsultaAuthorizationResponseAction(authorized)).toEqual({
      ok: false,
      error: 'Autorização só com evidência da operadora: número da guia na operadora, senha ou protocolo.',
    });
    m.recordManualAuthorizationResponseTx.mockRejectedValueOnce(new AuthorizationError('Autorização inexistente nesta clínica.', 'not_found'));
    expect(await recordConsultaAuthorizationResponseAction(authorized)).toEqual({ ok: false, error: 'Autorização inexistente nesta clínica.' });
    m.recordManualAuthorizationResponseTx.mockRejectedValueOnce(new ConveniosModuleDisabledError());
    const off = await recordConsultaAuthorizationResponseAction(authorized);
    expect(off.ok === false && off.error.startsWith('Convênios está desligado nesta clínica.')).toBe(true);
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('identificador adulterado (não UUID) é recusado antes do portão e do banco', async () => {
    const r = await recordConsultaAuthorizationResponseAction({ ...authorized, authorizationId: 'abc' });
    expect(r.ok).toBe(false);
    expect(m.requireCachedPermission).not.toHaveBeenCalled();
    expect(m.recordManualAuthorizationResponseTx).not.toHaveBeenCalled();
  });
});

describe('revisão humana do repasse (0163)', () => {
  const REVIEW = '66666666-6666-4666-8666-666666666666';
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue(SESSION);
    m.requireCachedPermission.mockResolvedValue(undefined);
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireFreshPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.decidePayoutReviewTx.mockResolvedValue({ reviewId: REVIEW, payoutId: 'p1', decision: 'reduce', reduceCents: 1500, dueCents: 2500 });
  });

  it('decidir: faturamento com permissão FRESCA; clínica da sessão; auditoria só com decisão e valores', async () => {
    const r = await decidePayoutReviewAction({ reviewId: REVIEW, decision: 'reduce', reason: 'Sessão parcialmente refeita', reduceCents: 1500 });
    expect(r).toEqual({ ok: true, data: { dueCents: 2500 } });
    expect(m.requireFreshPermission).toHaveBeenCalledWith('manage:faturamento_convenio');
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(['manage:faturamento_convenio']);
    expect(m.decidePayoutReviewTx).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC, reviewId: REVIEW, decision: 'reduce', reason: 'Sessão parcialmente refeita', reduceCents: 1500,
    });
    const audit = m.logAudit.mock.calls[0]![1] as { action: string; resourceType: string; after: { result: string } };
    expect([audit.action, audit.resourceType, audit.after.result]).toEqual(['health_insurance.payout.review_decided', 'hi_payout_review', 'reduce:1500;devido=2500']);
  });

  it('sem a permissão fresca, nada é decidido nem auditado', async () => {
    m.requireFreshPermission.mockRejectedValueOnce(new (AuthError as unknown as new (msg: string, code: string) => Error)('negado', 'forbidden'));
    const r = await decidePayoutReviewAction({ reviewId: REVIEW, decision: 'maintain', reason: 'Atendimento realizado' });
    expect(r.ok).toBe(false);
    expect(m.decidePayoutReviewTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('reduzir sem valor é recusado antes do banco; manter não leva valor ao serviço; erros do banco chegam com a mensagem do serviço', async () => {
    expect((await decidePayoutReviewAction({ reviewId: REVIEW, decision: 'reduce', reason: 'Sessão parcialmente refeita' })).ok).toBe(false);
    expect(m.decidePayoutReviewTx).not.toHaveBeenCalled();
    m.decidePayoutReviewTx.mockResolvedValueOnce({ reviewId: REVIEW, payoutId: 'p1', decision: 'maintain', reduceCents: null, dueCents: 6000 });
    await decidePayoutReviewAction({ reviewId: REVIEW, decision: 'maintain', reason: 'Atendimento realizado', reduceCents: 999 });
    expect(m.decidePayoutReviewTx).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ decision: 'maintain', reduceCents: null }));
    m.decidePayoutReviewTx.mockRejectedValueOnce(new PayoutReviewError('Esta revisão exige outra pessoa: quem tirou a guia do atendimento não decide (segregação da clínica ou valor em jogo).', 'segregation'));
    const seg = await decidePayoutReviewAction({ reviewId: REVIEW, decision: 'maintain', reason: 'Atendimento realizado' });
    expect(seg).toEqual({ ok: false, error: 'Esta revisão exige outra pessoa: quem tirou a guia do atendimento não decide (segregação da clínica ou valor em jogo).' });
  });

  it('política de segregação: administração (manage:convenios, D-2), auditada', async () => {
    const r = await setPayoutReviewPolicyAction({ segregation: true, independentAboveCents: 50000 });
    expect(r).toEqual({ ok: true, data: null });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(['manage:convenios']);
    expect(m.setPayoutReviewPolicyTx).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC, segregation: true, independentAboveCents: 50000 });
    const audit = m.logAudit.mock.calls[0]![1] as { action: string; after: { result: string } };
    expect([audit.action, audit.after.result]).toEqual(['health_insurance.payout.segregation_policy_changed', 'segregacao=sim;limite=50000']);
  });
});

describe('comprovante da autorização em partes (P6.3)', () => {
  const AUTHZ = '77777777-7777-4777-8777-777777777777';
  const CLAIMS = { v: 1, id: 'up-1', clinicId: CLINIC, userId: 'u1', authorizationId: AUTHZ, size: 10, sha256: 'a'.repeat(64), type: 'application/pdf', chunks: 1, exp: 9e15 };
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue(SESSION);
    m.requireCachedAnyPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.openReceiptUpload.mockResolvedValue(CLAIMS);
    m.beginReceiptUpload.mockResolvedValue({ uploadId: 'up-1', token: 't'.repeat(40), chunkBytes: 3, chunks: 1 });
  });

  it('início: só quem opera Convênios (recepção); autorização de outra clínica (ou inexistente) é recusada antes de qualquer token', async () => {
    m.execute.mockResolvedValueOnce([]);
    const no = await beginAuthorizationReceiptUploadAction({ authorizationId: AUTHZ, size: 10, sha256: 'a'.repeat(64), declaredType: 'application/pdf' });
    expect(no).toEqual({ ok: false, error: 'Autorização inexistente nesta clínica.' });
    expect(m.requireCachedAnyPermission).toHaveBeenCalledWith(['operate:convenios']);
    expect(m.beginReceiptUpload).not.toHaveBeenCalled();
    m.execute.mockResolvedValueOnce([{ '?column?': 1 }]);
    const ok = await beginAuthorizationReceiptUploadAction({ authorizationId: AUTHZ, size: 10, sha256: 'a'.repeat(64), declaredType: 'application/pdf' });
    expect(ok).toEqual({ ok: true, data: { token: 't'.repeat(40), chunkBytes: 3, chunks: 1 } });
    // Clínica e pessoa da SESSÃO, nunca do chamador.
    expect(m.beginReceiptUpload).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC, userId: 'u1', authorizationId: AUTHZ }));
  });

  it('parte: o token é aberto contra a sessão; sem conteúdo, recusa', async () => {
    const form = new FormData();
    form.set('token', 't'.repeat(40));
    form.set('index', '0');
    expect((await uploadAuthorizationReceiptChunkAction(form)).ok).toBe(false);
    form.set('chunk', new Blob([new Uint8Array([1, 2, 3])]));
    expect(await uploadAuthorizationReceiptChunkAction(form)).toEqual({ ok: true, data: null });
    expect(m.openReceiptUpload).toHaveBeenCalledWith('t'.repeat(40), { clinicId: CLINIC, userId: 'u1' });
    expect(m.putReceiptChunk).toHaveBeenCalledWith(expect.anything(), CLAIMS, 0, expect.any(Uint8Array));
  });

  it('fim: o mesmo arquivo já anexado devolve o anexo (idempotente); senão monta, anexa com auditoria e descarta as partes', async () => {
    m.execute.mockResolvedValueOnce([{ id: 'att-existente' }]);
    expect(await finishAuthorizationReceiptUploadAction({ token: 't'.repeat(40) })).toEqual({ ok: true, data: 'att-existente' });
    expect(m.assembleReceiptUpload).not.toHaveBeenCalled();
    expect(m.discardReceiptUpload).toHaveBeenCalledTimes(1);
    m.execute.mockResolvedValueOnce([]);
    m.assembleReceiptUpload.mockResolvedValueOnce(new Uint8Array([0x25, 0x50]));
    m.attachAuthorizationReceipt.mockImplementationOnce(async (_store: unknown, run: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>) =>
      run(async () => ({ attachmentId: 'att-novo', contentSha256: 'a'.repeat(64) })),
    );
    expect(await finishAuthorizationReceiptUploadAction({ token: 't'.repeat(40) })).toEqual({ ok: true, data: 'att-novo' });
    const audit = m.logAudit.mock.calls.at(-1)![1] as { action: string; resourceId: string };
    expect([audit.action, audit.resourceId]).toEqual(['health_insurance.authorization.receipt_attached', AUTHZ]);
    expect(m.discardReceiptUpload).toHaveBeenCalledTimes(2);
  });
});
