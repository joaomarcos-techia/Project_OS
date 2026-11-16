/**
 * Orquestração da aprovação com emissão (`approveConsultaGuide`): permissão
 * fresca ANTES de tudo; a carteirinha só é lida (com auditoria) depois de a guia
 * existir e ter carteirinha; nada é emitido se a leitura auditada não devolver o
 * número. A emissão transacional em si é provada contra o banco real em
 * `scripts/security/health-insurance-guide-issuance-db.ts` (6/6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  withTenant: vi.fn(),
  requireUser: vi.fn(),
  requireFreshPermission: vi.fn(),
  readCard: vi.fn(),
  encryptForTenant: vi.fn(),
  logAudit: vi.fn(),
  issueSpSadtGuide: vi.fn(),
  head: [] as unknown[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: m.withTenant }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: m.requireUser,
  requireFreshPermission: m.requireFreshPermission,
}));
vi.mock('@/lib/crypto/encryption', () => ({ encryptForTenant: m.encryptForTenant }));
vi.mock('@/lib/audit/log', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: async () => ({ ip: null, userAgent: null, requestId: 'r1' }),
}));
vi.mock('./membership-access', () => ({ readMembershipCardNumberAudited: m.readCard }));
// A emissão SP/SADT mora em outro módulo: substituível, para provar a orquestração da trilha.
vi.mock('./sadt-issuance', () => ({ issueSpSadtGuide: m.issueSpSadtGuide }));

import { PERMISSIONS } from '@/lib/auth/permissions';

import { approveConsultaGuide, GuideIssuanceError } from './guide-issuance';

const fakeTx = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => m.head }) }) }),
  execute: async () => [{ timezone: 'America/Sao_Paulo', nome: 'Dra. Sintética' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.head = [{ membershipId: 'card-1', executant: 'doc-1' }];
  m.withTenant.mockImplementation(async (_c: string, fn: (tx: unknown) => unknown) => fn(fakeTx));
  m.requireUser.mockResolvedValue({ userId: 'user-1' });
  m.requireFreshPermission.mockResolvedValue(undefined);
});

describe('approveConsultaGuide', () => {
  it('sem a permissão de faturamento: nada é lido, nem a guia nem a carteirinha', async () => {
    m.requireFreshPermission.mockRejectedValueOnce(new Error('forbidden'));
    await expect(approveConsultaGuide('clinic-1', 'guide-1')).rejects.toThrow('forbidden');
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    expect(m.withTenant).not.toHaveBeenCalled();
    expect(m.readCard).not.toHaveBeenCalled();
  });

  it('guia inexistente ou sem carteirinha: a carteirinha não é lida', async () => {
    m.head = [];
    await expect(approveConsultaGuide('clinic-1', 'guide-1')).rejects.toBeInstanceOf(
      GuideIssuanceError,
    );
    m.head = [{ membershipId: null, executant: 'doc-1' }];
    await expect(approveConsultaGuide('clinic-1', 'guide-1')).rejects.toBeInstanceOf(
      GuideIssuanceError,
    );
    expect(m.readCard).not.toHaveBeenCalled();
  });

  it('lê a carteirinha DA GUIA com finalidade de geração de guia; sem número, não emite', async () => {
    m.readCard.mockResolvedValueOnce(null);
    await expect(approveConsultaGuide('clinic-1', 'guide-1')).rejects.toBeInstanceOf(
      GuideIssuanceError,
    );
    expect(m.readCard).toHaveBeenCalledWith(
      'clinic-1',
      'card-1',
      'geracao_guia',
      'convenios/guias/aprovar',
    );
    expect(m.encryptForTenant).not.toHaveBeenCalled();
    // Uma leitura do cabeçalho; nenhuma transação de emissão aberta.
    expect(m.withTenant).toHaveBeenCalledTimes(1);
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('aprovada: grava a trilha na MESMA transação da emissão, com a pessoa da sessão e sem carteirinha', async () => {
    m.head = [{ membershipId: 'card-1', executant: 'doc-1', guideType: 'sp_sadt' }];
    m.readCard.mockResolvedValueOnce({ membershipId: 'card-1', cardNumber: '0081234500012345', auditEventId: 'a1' });
    m.issueSpSadtGuide.mockResolvedValueOnce({ snapshotId: 'snap-1', revision: 2, sha256: 'f'.repeat(64) });
    await expect(approveConsultaGuide('clinic-1', 'guide-1')).resolves.toEqual({
      snapshotId: 'snap-1',
      revision: 2,
      sha256: 'f'.repeat(64),
    });
    expect(m.logAudit).toHaveBeenCalledTimes(1);
    const [tx, entry] = m.logAudit.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(tx).toBe(fakeTx); // a mesma transação da emissão
    expect(entry).toMatchObject({
      clinicId: 'clinic-1',
      userId: 'user-1',
      action: 'health_insurance.guide.approved',
      resourceType: 'hi_guide',
      resourceId: 'guide-1',
      after: { guideType: 'sp_sadt', revision: 2, snapshotSha256: 'f'.repeat(64) },
    });
    expect(JSON.stringify(entry)).not.toContain('0081234500012345');
  });

  it('emissão recusada (pendência, corrida perdida, D24, módulo desligado): nenhuma trilha de aprovação', async () => {
    m.head = [{ membershipId: 'card-1', executant: 'doc-1', guideType: 'sp_sadt' }];
    m.readCard.mockResolvedValueOnce({ membershipId: 'card-1', cardNumber: '0081234500012345', auditEventId: 'a1' });
    m.issueSpSadtGuide.mockRejectedValueOnce(new GuideIssuanceError('a guia já foi aprovada'));
    await expect(approveConsultaGuide('clinic-1', 'guide-1')).rejects.toBeInstanceOf(GuideIssuanceError);
    expect(m.logAudit).not.toHaveBeenCalled();
  });
});
