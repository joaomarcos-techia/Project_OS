/**
 * LGPD (auditoria 2026-09-10, peso 5) — trilha de LEITURA de prontuário.
 *
 * O teste prova cinco coisas sobre `readProntuarioAudited` e três sobre o
 * repositório inteiro. `logAudit` roda REAL (só a tx e a identidade são
 * substituídas): o que é verificado é a linha que iria para `audit_events`,
 * não um dublê de auditoria.
 */
import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const PRONTUARIO_ID = '00000000-0000-4000-8000-000000000001';
const CLINIC_ID = '00000000-0000-4000-8000-00000000000a';
const USER_ID = '00000000-0000-4000-8000-00000000000b';
const OTHER_USER_ID = '00000000-0000-4000-8000-00000000000c';

/** Linha crua do banco; `content_encrypted` NUNCA pode aparecer no audit. */
const ROW = {
  id: PRONTUARIO_ID,
  clinicId: CLINIC_ID,
  patientId: '00000000-0000-4000-8000-00000000000d',
  contentEncrypted: 'v1:ciphertext-do-soap',
  status: 'rascunho',
  version: 3,
};

/** SOAP decifrado — o dado que a trilha existe para proteger. */
const DETAIL = {
  id: PRONTUARIO_ID,
  clinicId: CLINIC_ID,
  patientId: ROW.patientId,
  status: 'rascunho' as const,
  version: 3,
  content: { subjetivo: 'paciente relata ideacao suicida', objetivo: '', avaliacao: '', plano: '' },
};

const { withTenant, requireUser, toProntuarioDetail, recordImpersonationAudit } = vi.hoisted(
  () => ({
    withTenant: vi.fn(),
    requireUser: vi.fn(),
    toProntuarioDetail: vi.fn(),
    recordImpersonationAudit: vi.fn(),
  }),
);

vi.mock('@/lib/db/tenant', () => ({ withTenant }));
vi.mock('@/lib/auth/tenant-context', () => ({ requireUser }));
vi.mock('@/lib/audit/impersonation-extra', () => ({ recordImpersonationAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: async () => ({
    ip: '127.0.0.1',
    userAgent: 'vitest',
    requestId: '00000000-0000-4000-8000-00000000000e',
  }),
}));
vi.mock('./queries', () => ({ toProntuarioDetail }));

import { readProntuarioAudited } from './prontuario-access';

type AuditRow = Record<string, unknown>;

/**
 * Tx sintética: devolve `rows` no SELECT e guarda o INSERT do audit. Quando
 * `failAudit` é true o INSERT lança — é assim que o teste de fail-closed
 * distingue "trilha gravada" de "trilha ignorada em silêncio".
 */
function fakeTx(rows: unknown[], failAudit = false) {
  const inserted: AuditRow[] = [];
  const query: Record<string, unknown> = {};
  for (const step of ['from', 'where', 'limit']) query[step] = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) => resolve(rows);
  const tx = {
    select: vi.fn(() => query),
    insert: vi.fn(() => ({
      values: vi.fn((row: AuditRow) => {
        if (failAudit) throw new Error('audit_events INSERT recusado');
        inserted.push(row);
        return Promise.resolve();
      }),
    })),
  };
  return { tx, inserted };
}

function arrange(rows: unknown[], opts: { failAudit?: boolean; impersonation?: boolean } = {}) {
  const { tx, inserted } = fakeTx(rows, opts.failAudit);
  withTenant.mockImplementation(async (_clinicId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(tx),
  );
  requireUser.mockResolvedValue({
    userId: USER_ID,
    clinicId: CLINIC_ID,
    session: opts.impersonation
      ? {
          impersonation: {
            impersonationId: '00000000-0000-4000-8000-00000000000f',
            clinicId: CLINIC_ID,
            startedAt: '2026-09-10T00:00:00.000Z',
          },
        }
      : undefined,
  });
  toProntuarioDetail.mockResolvedValue(DETAIL);
  return { inserted };
}

describe('leitura de prontuário deixa trilha (LGPD, peso 5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grava clinical.prontuario.viewed com o usuário da SESSÃO, não do caller', async () => {
    const { inserted } = arrange([ROW]);
    // A assinatura não aceita userId: o caller passa só o escopo do gate.
    const detail = await readProntuarioAudited(CLINIC_ID, 'prontuario_editor', {
      prontuarioId: PRONTUARIO_ID,
    });

    expect(detail).toBe(DETAIL);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      clinicId: CLINIC_ID,
      // Vem de requireUser(); nenhum argumento poderia ter falsificado isto.
      userId: USER_ID,
      action: 'clinical.prontuario.viewed',
      resourceType: 'prontuario',
      resourceId: PRONTUARIO_ID,
      after: { surface: 'prontuario_editor', status: 'rascunho', version: 3 },
    });
    expect(inserted[0]?.userId).not.toBe(OTHER_USER_ID);
  });

  it('não leva conteúdo clínico nem ciphertext para dentro do audit', async () => {
    const { inserted } = arrange([ROW]);
    await readProntuarioAudited(CLINIC_ID, 'consultorio_atendimento', {
      appointmentId: '00000000-0000-4000-8000-000000000010',
    });

    const serialized = JSON.stringify(inserted[0]);
    for (const leak of ['suicida', 'subjetivo', ROW.contentEncrypted, ROW.patientId]) {
      expect(serialized).not.toContain(leak);
    }
    expect(inserted[0]?.after).toMatchObject({ surface: 'consultorio_atendimento' });
  });

  it('fail-closed: audit que falha derruba a leitura, o SOAP não sai da função', async () => {
    arrange([ROW], { failAudit: true });
    await expect(
      readProntuarioAudited(CLINIC_ID, 'prontuario_editor', { prontuarioId: PRONTUARIO_ID }),
    ).rejects.toThrow('audit_events INSERT recusado');
  });

  it('prontuário inexistente no tenant: nada é decifrado e nada é auditado', async () => {
    const { inserted } = arrange([]);
    await expect(
      readProntuarioAudited(CLINIC_ID, 'prontuario_editor', { prontuarioId: PRONTUARIO_ID }),
    ).resolves.toBeNull();
    expect(toProntuarioDetail).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('suporte impersonando deixa o cross-reference em super_admin_actions', async () => {
    arrange([ROW], { impersonation: true });
    await readProntuarioAudited(CLINIC_ID, 'prontuario_editor', { prontuarioId: PRONTUARIO_ID });

    expect(recordImpersonationAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        superAdminId: USER_ID,
        action: 'clinical.prontuario.viewed',
        resourceType: 'prontuario',
        resourceId: PRONTUARIO_ID,
      }),
    );
  });

  it('sem impersonate não inventa linha em super_admin_actions', async () => {
    arrange([ROW]);
    await readProntuarioAudited(CLINIC_ID, 'prontuario_editor', { prontuarioId: PRONTUARIO_ID });
    expect(recordImpersonationAudit).not.toHaveBeenCalled();
  });
});

/**
 * Gate estático. Os testes acima provam o comportamento de UM leitor; este
 * impede que o próximo leitor nasça ao lado dele sem trilha. `toProntuarioDetail`
 * é o ponto único de `decryptJson` do SOAP: quem o importa produz prontuário
 * decifrado e precisa estar nesta lista curta, com auditoria explicada.
 */
describe('gate: nenhum leitor de prontuário decifrado sem trilha', () => {
  const root = path.join(process.cwd(), 'src');
  /**
   * Lista fechada de propósito — inclusive dentro do próprio contexto. Um
   * arquivo novo em `contexts/clinical/` que decifre SOAP tem de entrar aqui
   * por decisão explícita, com a auditoria dele dita em uma linha.
   */
  const ALLOWED = new Set([
    // Ponto único de decrypt + o `before` das mutações (auditadas na mutação).
    'contexts/clinical/queries.ts',
    // Mutações: audit na mesma tx via idempotentMutation/auditedMutation.
    'contexts/clinical/actions.ts',
    // Leitura auditada — o assunto deste arquivo.
    'contexts/clinical/prontuario-access.ts',
    'contexts/clinical/prontuario-access.test.ts',
    // Só substitui a projeção por um dublê; não decifra nada.
    'contexts/clinical/actions-references.test.ts',
  ]);

  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(file, found);
      else if (/\.tsx?$/.test(entry.name)) found.push(file);
    }
    return found;
  }

  const files = sources(root).map((file) => ({
    id: path.relative(root, file).split(path.sep).join('/'),
    content: fs.readFileSync(file, 'utf8'),
  }));

  it('só o contexto Clinical e o leitor auditado tocam toProntuarioDetail', () => {
    const offenders = files
      .filter((entry) => !ALLOWED.has(entry.id) && entry.content.includes('toProntuarioDetail'))
      .map((entry) => entry.id);
    expect(offenders).toEqual([]);
  });

  it('os leitores exportados sem trilha continuam removidos do contrato', () => {
    // `getProntuarioByAppointment` foi removido; `getProntuarioById` deixou de
    // ser exportado. Reintroduzir qualquer um deles reabre a leitura sem audit.
    const queries = files.find((entry) => entry.id === 'contexts/clinical/queries.ts');
    expect(queries).toBeDefined();
    expect(queries?.content).not.toContain('export async function getProntuarioById');
    expect(queries?.content).not.toContain('export async function getProntuarioByAppointment');
    const offenders = files
      .filter(
        (entry) =>
          !ALLOWED.has(entry.id) &&
          (entry.content.includes('getProntuarioById') ||
            entry.content.includes('getProntuarioByAppointment')),
      )
      .map((entry) => entry.id);
    expect(offenders).toEqual([]);
  });

  it('as duas telas que abrem prontuário chamam o leitor auditado', () => {
    for (const screen of [
      'app/(app)/(shell)/pacientes/[id]/prontuarios/[pid]/page.tsx',
      'app/(app)/(shell)/consultorio/actions.ts',
    ]) {
      const source = files.find((entry) => entry.id === screen);
      expect(source, `${screen} sumiu — reveja o gate`).toBeDefined();
      expect(source?.content).toContain('readProntuarioAudited');
    }
  });
});
