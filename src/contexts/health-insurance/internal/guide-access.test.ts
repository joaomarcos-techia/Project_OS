import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '@/lib/auth/permissions';

import { serializeGuideSnapshot, type GuideSnapshotContent } from '../tiss/guides/snapshot';

const CLINIC_ID = '00000000-0000-4000-8000-00000000000a';
const G1 = '00000000-0000-4000-8000-000000000101';
const G2 = '00000000-0000-4000-8000-000000000102';
const USER_ID = '00000000-0000-4000-8000-00000000000b';
const CARD = '7700000012345678';
const CIPHER = 'v1:ciphertext-da-guia';

const m = vi.hoisted(() => ({
  withTenant: vi.fn(),
  requireUser: vi.fn(),
  requireFreshPermission: vi.fn(),
  decryptForTenant: vi.fn(),
  logAudit: vi.fn(),
  recordImpersonationAudit: vi.fn(),
  loadApprovedSnapshots: vi.fn(),
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
vi.mock('./guide-snapshot-repo', () => ({ loadApprovedSnapshots: m.loadApprovedSnapshots }));

import {
  GUIDE_ACCESS_DENIED_ACTION,
  GUIDE_CONTENT_VIEWED_ACTION,
  GUIDE_INTEGRITY_FAILED_ACTION,
  GUIDE_USER_OPERATIONS,
  GuideAccessError,
  GuideIntegrityError,
  readBatchGuidesAudited,
  readGuideContentAudited,
  readGuidesAsSystem,
} from './guide-access';

const content: GuideSnapshotContent = {
  schema: 'qoro.hi.guide-snapshot/1',
  guideType: 'consulta',
  tissVersion: '4.03.00',
  terminologyVersion: '202609',
  data: {
    registroANS: '123456',
    numeroGuiaPrestador: '42',
    beneficiario: { numeroCarteira: CARD, atendimentoRN: 'N' },
  } as unknown as GuideSnapshotContent['data'],
} as GuideSnapshotContent;
const { json, sha256 } = serializeGuideSnapshot(content);

const row = (id: string, over: Record<string, unknown> = {}) => ({
  guideId: id,
  guideType: 'consulta',
  number: '42',
  status: 'approved',
  revision: 1,
  snapshotId: `${id.slice(0, -3)}999`,
  snapshotRevision: 1,
  contentEncrypted: CIPHER,
  contentSha256: sha256,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.withTenant.mockImplementation(async (_c: string, fn: (tx: unknown) => unknown) => fn({}));
  m.requireUser.mockResolvedValue({ userId: USER_ID, session: {} });
  m.requireFreshPermission.mockResolvedValue(undefined);
  m.decryptForTenant.mockResolvedValue(json);
  m.logAudit.mockResolvedValue('audit-1');
  m.loadApprovedSnapshots.mockResolvedValue([row(G1)]);
});

const audits = () => m.logAudit.mock.calls.map((c) => c[1] as Record<string, unknown>);

describe('readGuideContentAudited (R57/R85, parte do módulo)', () => {
  it('confere o SHA-256, decifra e registra a leitura com operação, finalidade e autor', async () => {
    const r = await readGuideContentAudited({
      clinicId: CLINIC_ID,
      guideId: G1,
      operation: 'guide_view',
      surface: 'convenios/guias/detalhe',
    });
    expect(r.content).toEqual(content);
    expect(r.auditEventId).toBe('audit-1');
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.VIEW_FINANCIAL);
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      clinicId: CLINIC_ID,
      userId: USER_ID,
      action: GUIDE_CONTENT_VIEWED_ACTION,
      resourceType: 'hi_guide',
      resourceId: G1,
      after: {
        operation: 'guide_view',
        purpose: 'conferencia_guia',
        surface: 'convenios/guias/detalhe',
        outcome: 'granted',
        actor: { kind: 'user' },
        guideStatus: 'approved',
        revision: 1,
      },
    });
    // O GUC do autor vai junto da transação (histórico do banco sabe quem leu).
    expect(m.withTenant.mock.calls[0]![2]).toBe(USER_ID);
  });

  it('o registro de auditoria nunca leva carteirinha, conteúdo, ciphertext nem hash', async () => {
    await readGuideContentAudited({
      clinicId: CLINIC_ID,
      guideId: G1,
      operation: 'guide_pdf',
      surface: 'convenios/guias/pdf',
    });
    const logged = JSON.stringify(m.logAudit.mock.calls);
    expect(logged).not.toContain(CARD);
    expect(logged).not.toContain(CIPHER);
    expect(logged).not.toContain(sha256);
    expect(logged).not.toContain('numeroCarteira');
  });

  it('cada operação exige a sua permissão (fresca); a finalidade vem da operação', async () => {
    for (const [operation, spec] of Object.entries(GUIDE_USER_OPERATIONS)) {
      if (spec.batch) continue;
      m.requireFreshPermission.mockClear();
      m.logAudit.mockClear();
      await readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: operation as keyof typeof GUIDE_USER_OPERATIONS,
        surface: 'tela',
      });
      expect(m.requireFreshPermission).toHaveBeenCalledWith(spec.permission);
      expect(audits()[0]!.after).toMatchObject({ operation, purpose: spec.purpose });
    }
  });

  it('sem permissão: nada é lido nem decifrado, e a negação fica registrada', async () => {
    m.requireFreshPermission.mockRejectedValueOnce(new Error('forbidden'));
    await expect(
      readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: 'guide_view',
        surface: 'tela',
      }),
    ).rejects.toThrow('forbidden');
    expect(m.loadApprovedSnapshots).not.toHaveBeenCalled();
    expect(m.decryptForTenant).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      action: GUIDE_ACCESS_DENIED_ACTION,
      resourceId: G1,
      after: { outcome: 'denied', reason: 'permission', operation: 'guide_view' },
    });
  });

  it('operação fora do catálogo é recusada antes de qualquer leitura ou registro', async () => {
    await expect(
      readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: 'curiosidade' as never,
        surface: 'tela',
      }),
    ).rejects.toMatchObject({ reason: 'unknown_operation' });
    expect(m.requireUser).not.toHaveBeenCalled();
    expect(m.withTenant).not.toHaveBeenCalled();
  });

  it('guia de outra clínica (ou inexistente): negado, registrado, sem decifrar', async () => {
    m.loadApprovedSnapshots.mockResolvedValueOnce([]);
    await expect(
      readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: 'guide_view',
        surface: 'tela',
      }),
    ).rejects.toMatchObject({ reason: 'not_found' });
    expect(m.decryptForTenant).not.toHaveBeenCalled();
    expect(audits()[0]).toMatchObject({
      clinicId: CLINIC_ID,
      action: GUIDE_ACCESS_DENIED_ACTION,
      after: { reason: 'not_found' },
    });
  });

  it('guia ainda não emitida (sem snapshot): negado, sem decifrar', async () => {
    m.loadApprovedSnapshots.mockResolvedValueOnce([
      row(G1, { status: 'pending_data', contentEncrypted: null, contentSha256: null }),
    ]);
    await expect(
      readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: 'guide_view',
        surface: 'tela',
      }),
    ).rejects.toMatchObject({ reason: 'not_emitted' });
    expect(m.decryptForTenant).not.toHaveBeenCalled();
  });

  it('conteúdo que não confere com o SHA-256: nada sai e a falha de integridade é registrada', async () => {
    m.decryptForTenant.mockResolvedValueOnce(json.replace(CARD, '7700000099999999'));
    await expect(
      readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: 'guide_view',
        surface: 'tela',
      }),
    ).rejects.toBeInstanceOf(GuideIntegrityError);
    expect(audits().map((a) => a.action)).toEqual([GUIDE_INTEGRITY_FAILED_ACTION]);
    expect(JSON.stringify(m.logAudit.mock.calls)).not.toContain('7700000099999999');
  });

  it('se o registro de auditoria falhar, o conteúdo não é devolvido', async () => {
    m.logAudit.mockRejectedValueOnce(new Error('audit down'));
    await expect(
      readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: 'guide_view',
        surface: 'tela',
      }),
    ).rejects.toThrow('audit down');
  });

  it('superfície com texto livre ou número longo é recusada (o log não vira canal de dado)', async () => {
    for (const surface of ['tela com espaço', `busca/${CARD}`, 'Tela', '']) {
      await expect(
        readGuideContentAudited({
          clinicId: CLINIC_ID,
          guideId: G1,
          operation: 'guide_view',
          surface,
        }),
      ).rejects.toBeInstanceOf(GuideAccessError);
    }
    expect(m.withTenant).not.toHaveBeenCalled();
  });

  it('super admin em impersonação: a leitura também vai para o registro de impersonação', async () => {
    m.requireUser.mockResolvedValueOnce({
      userId: USER_ID,
      session: { impersonation: { impersonationId: 'imp-1' } },
    });
    await readGuideContentAudited({
      clinicId: CLINIC_ID,
      guideId: G1,
      operation: 'admin_query',
      surface: 'admin',
    });
    expect(m.recordImpersonationAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        impersonationId: 'imp-1',
        auditEventId: 'audit-1',
        resourceId: G1,
      }),
    );
  });
});

describe('readBatchGuidesAudited (lote, tudo ou nada)', () => {
  it('um evento por guia, com a referência do lote', async () => {
    m.loadApprovedSnapshots.mockResolvedValueOnce([row(G1), row(G2)]);
    const reads = await readBatchGuidesAudited({
      clinicId: CLINIC_ID,
      guideIds: [G1, G2],
      operation: 'batch_xml_export',
      batchRef: 'lote-0001',
      surface: 'convenios/lotes/exportar',
    });
    expect(reads.map((r) => r.guideId)).toEqual([G1, G2]);
    expect(m.requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_FINANCIAL);
    expect(audits().map((a) => [a.resourceId, (a.after as { batchRef: string }).batchRef])).toEqual(
      [
        [G1, 'lote-0001'],
        [G2, 'lote-0001'],
      ],
    );
  });

  it('faltou uma guia: nenhuma é decifrada', async () => {
    m.loadApprovedSnapshots.mockResolvedValueOnce([row(G1)]);
    await expect(
      readBatchGuidesAudited({
        clinicId: CLINIC_ID,
        guideIds: [G1, G2],
        operation: 'billing',
        batchRef: 'lote-0002',
        surface: 'convenios/lotes',
      }),
    ).rejects.toMatchObject({ reason: 'not_found' });
    expect(m.decryptForTenant).not.toHaveBeenCalled();
    expect(audits().every((a) => a.action === GUIDE_ACCESS_DENIED_ACTION)).toBe(true);
  });

  it('operação de uma guia não serve para lote (e vice-versa)', async () => {
    await expect(
      readBatchGuidesAudited({
        clinicId: CLINIC_ID,
        guideIds: [G1],
        operation: 'guide_view',
        batchRef: 'lote-0003',
        surface: 'x',
      }),
    ).rejects.toMatchObject({ reason: 'invalid_argument' });
    await expect(
      readGuideContentAudited({
        clinicId: CLINIC_ID,
        guideId: G1,
        operation: 'billing',
        surface: 'x',
      }),
    ).rejects.toMatchObject({ reason: 'invalid_argument' });
  });
});

describe('readGuidesAsSystem (workers com identidade técnica)', () => {
  it('registra o serviço e o job como autor, sem usuário e sem sessão', async () => {
    await readGuidesAsSystem({
      clinicId: CLINIC_ID,
      guideIds: [G1],
      operation: 'operator_integration',
      service: 'insurance-connector',
      jobId: '00000000-0000-4000-8000-0000000000f1',
    });
    expect(m.requireUser).not.toHaveBeenCalled();
    expect(audits()[0]).toMatchObject({
      userId: null,
      after: {
        purpose: 'integracao_operadora',
        actor: {
          kind: 'system',
          service: 'insurance-connector',
          jobId: '00000000-0000-4000-8000-0000000000f1',
        },
        outcome: 'granted',
      },
      requestContext: { userAgent: 'system:insurance-connector' },
    });
    // Mesmo o worker lê dentro do tenant (RLS), nunca fora.
    expect(m.withTenant.mock.calls[0]![0]).toBe(CLINIC_ID);
  });

  it('serviço fora da lista da operação é recusado antes de qualquer leitura', async () => {
    await expect(
      readGuidesAsSystem({
        clinicId: CLINIC_ID,
        guideIds: [G1],
        operation: 'operator_integration',
        service: 'insurance-reconcile',
        jobId: 'job-1',
      }),
    ).rejects.toMatchObject({ reason: 'service_not_allowed' });
    expect(m.withTenant).not.toHaveBeenCalled();
  });
});

describe('invariante: só guide-access.ts decifra o snapshot da guia', () => {
  it('nenhum outro arquivo combina o snapshot da guia com decryptForTenant', () => {
    const root = path.join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/u.test(e.name) && !/\.test\.tsx?$/u.test(e.name)) {
          const text = fs.readFileSync(p, 'utf8');
          if (
            /hiGuideSnapshots|hi_guide_snapshots|loadApprovedSnapshots|guide-snapshot-repo/u.test(
              text,
            ) &&
            /decryptForTenant/u.test(text)
          )
            offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([
      path.join('contexts', 'health-insurance', 'internal', 'guide-access.ts'),
    ]);
  });
});
