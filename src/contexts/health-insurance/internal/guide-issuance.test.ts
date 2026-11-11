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
  head: [] as unknown[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: m.withTenant }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: m.requireUser,
  requireFreshPermission: m.requireFreshPermission,
}));
vi.mock('@/lib/crypto/encryption', () => ({ encryptForTenant: m.encryptForTenant }));
vi.mock('./membership-access', () => ({ readMembershipCardNumberAudited: m.readCard }));

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
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FINANCIAL);
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
  });
});
