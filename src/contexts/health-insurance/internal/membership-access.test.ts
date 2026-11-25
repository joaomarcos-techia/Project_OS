import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const CLINIC_ID = '00000000-0000-4000-8000-00000000000a';
const MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-00000000000b';
const CARD = '7700000012345678';

const m = vi.hoisted(() => ({
  withTenant: vi.fn(),
  requireUser: vi.fn(),
  requireFreshPermission: vi.fn(),
  decryptForTenant: vi.fn(),
  logAudit: vi.fn(),
  recordImpersonationAudit: vi.fn(),
  rows: [] as unknown[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: m.withTenant }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: m.requireUser,
  requireFreshPermission: m.requireFreshPermission,
}));
vi.mock('@/lib/crypto/encryption', () => ({ decryptForTenant: m.decryptForTenant }));
vi.mock('@/lib/audit/log', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/audit/impersonation-extra', () => ({
  recordImpersonationAudit: m.recordImpersonationAudit,
}));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: async () => ({ ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-1' }),
}));

import { PERMISSIONS } from '@/lib/auth/permissions';

import {
  CARD_NUMBER_VIEWED_ACTION,
  CardAccessPurposeError,
  readMembershipCardNumberAudited,
} from './membership-access';

const fakeTx = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => m.rows }) }) }),
};

beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [
    { id: MEMBERSHIP_ID, clinicId: CLINIC_ID, cardNumberEncrypted: 'v1:cipher', status: 'active' },
  ];
  m.withTenant.mockImplementation(async (_c: string, fn: (tx: unknown) => unknown) => fn(fakeTx));
  m.requireUser.mockResolvedValue({ userId: USER_ID, session: {} });
  m.requireFreshPermission.mockResolvedValue(undefined);
  m.decryptForTenant.mockResolvedValue(CARD);
  m.logAudit.mockResolvedValue('audit-1');
});

describe('readMembershipCardNumberAudited (R85, parte do módulo)', () => {
  it('decifra, registra a leitura com finalidade e devolve o número', async () => {
    const r = await readMembershipCardNumberAudited(
      CLINIC_ID,
      MEMBERSHIP_ID,
      'geracao_guia',
      'guia_consulta',
    );
    expect(r).toEqual({ membershipId: MEMBERSHIP_ID, cardNumber: CARD, auditEventId: 'audit-1' });
    expect(m.logAudit).toHaveBeenCalledTimes(1);
    const [, args] = m.logAudit.mock.calls[0]!;
    expect(args).toMatchObject({
      clinicId: CLINIC_ID,
      userId: USER_ID,
      action: CARD_NUMBER_VIEWED_ACTION,
      resourceType: 'hi_membership',
      resourceId: MEMBERSHIP_ID,
      after: { purpose: 'geracao_guia', surface: 'guia_consulta', membershipStatus: 'active' },
    });
  });

  it('o registro de auditoria nunca contém o número, os 4 últimos nem o ciphertext', async () => {
    await readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'atendimento', 'recepcao');
    const logged = JSON.stringify(m.logAudit.mock.calls[0]![1]);
    expect(logged).not.toContain(CARD);
    expect(logged).not.toContain(CARD.slice(-4) + '"');
    expect(logged).not.toContain('v1:cipher');
  });

  it('cada finalidade exige a sua permissão, conferida de forma fresca', async () => {
    await readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'faturamento', 'lote');
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    await readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'exportacao', 'lgpd');
    expect(m.requireFreshPermission).toHaveBeenLastCalledWith(PERMISSIONS.EXPORT_PATIENT);
  });

  it('sem a permissão, nada é lido nem decifrado', async () => {
    m.requireFreshPermission.mockRejectedValueOnce(new Error('forbidden'));
    await expect(
      readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'geracao_guia', 'x'),
    ).rejects.toThrow('forbidden');
    expect(m.withTenant).not.toHaveBeenCalled();
    expect(m.decryptForTenant).not.toHaveBeenCalled();
  });

  it('finalidade fora do catálogo é recusada antes de qualquer leitura (não é escolha livre)', async () => {
    await expect(
      readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'curiosidade' as never, 'x'),
    ).rejects.toBeInstanceOf(CardAccessPurposeError);
    expect(m.requireFreshPermission).not.toHaveBeenCalled();
    expect(m.withTenant).not.toHaveBeenCalled();
  });

  it('carteirinha que não é da clínica: null, sem decifrar e sem registrar leitura', async () => {
    m.rows = [];
    expect(
      await readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'atendimento', 'x'),
    ).toBeNull();
    expect(m.decryptForTenant).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('fail-closed: se a auditoria falhar, o número não sai', async () => {
    m.logAudit.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'atendimento', 'x'),
    ).rejects.toThrow('audit down');
  });

  it('acesso de super admin impersonando é registrado também na trilha de impersonação', async () => {
    m.requireUser.mockResolvedValue({
      userId: USER_ID,
      session: { impersonation: { impersonationId: 'imp-1' } },
    });
    await readMembershipCardNumberAudited(CLINIC_ID, MEMBERSHIP_ID, 'atendimento', 'suporte');
    expect(m.recordImpersonationAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        impersonationId: 'imp-1',
        auditEventId: 'audit-1',
        clinicId: CLINIC_ID,
      }),
    );
  });
});

describe('invariante: só este arquivo decifra o número da carteirinha', () => {
  it('nenhum outro arquivo de src combina cardNumberEncrypted com decryptForTenant', () => {
    const root = path.join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/u.test(e.name) && !/\.test\.tsx?$/u.test(e.name)) {
          const t = fs.readFileSync(p, 'utf8');
          if (/cardNumberEncrypted|card_number_encrypted/u.test(t) && /decryptForTenant/u.test(t)) {
            offenders.push(path.relative(root, p).replace(/\\/gu, '/'));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual(['contexts/health-insurance/internal/membership-access.ts']);
  });
});
