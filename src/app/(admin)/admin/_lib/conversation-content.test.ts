import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S-01 / ADR-073 — matriz de testes da abertura de conversa no console.
 *
 * Unidade (com `superAdminAuditedRead` e `sanitizePayload` REAIS e tx sintética):
 * sessão da mesma clínica, sem sessão, sessão de outra clínica, ids adulterados,
 * falha da trilha, abertura concorrente, falha de decifragem, super_admin sem
 * AAL2, logs e autoria. Gate estático (no fim): quem decifra no `(admin)`, quem
 * lê as linhas com ciphertext, e a página sem prefetch.
 */

const {
  requireSuperAdmin,
  requireUser,
  transaction,
  decryptForTenant,
  requestContext,
  emit,
  getMetadata,
  findContentRowsTx,
} = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  requireUser: vi.fn(),
  transaction: vi.fn(),
  decryptForTenant: vi.fn(),
  requestContext: vi.fn(),
  emit: vi.fn(),
  getMetadata: vi.fn(),
  findContentRowsTx: vi.fn(),
}));

vi.mock('@/lib/auth/tenant-context', () => ({ requireSuperAdmin, requireUser }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction } }));
vi.mock('@/lib/crypto', () => ({ decryptForTenant }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
// `toMessageMeta` fica REAL (é a projeção que o modo sem sessão usa); só o
// acesso ao banco é trocado.
vi.mock('./repositories/conversations.repo', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return { ...original, conversationsRepository: { getMetadata, findContentRowsTx } };
});

import {
  CONVERSATION_CONTENT_VIEWED,
  openConversationForAdmin,
  UNAVAILABLE_TEXT,
} from './conversation-content';
import { toMessageMeta } from './repositories/conversations.repo';

const CLINIC_X = '11111111-1111-4111-8111-111111111111';
const CLINIC_Y = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const IMP = '44444444-4444-4444-8444-444444444444';
const SECRET_TEXT = 'Estou com dor no peito desde ontem';
const CIPHERTEXT = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    direction: 'in' as const,
    sentByUserId: null,
    sentViaBusinessApp: false,
    intent: null,
    toolCalls: null,
    model: null,
    latencyMs: null,
    createdAt: new Date('2026-11-15T12:00:00.000Z'),
    contentEncrypted: CIPHERTEXT,
    ...over,
  };
}

const head = { id: CONV, status: 'active', clinicNome: 'Clínica Aurora' };

function superAdmin(sessionClinicId?: string) {
  return {
    userId: 'admin-1',
    isSuperAdmin: true,
    aal: 'aal2',
    session: sessionClinicId
      ? {
          impersonation: {
            impersonationId: IMP,
            clinicId: sessionClinicId,
            startedAt: '2026-11-15T11:30:00.000Z',
          },
        }
      : undefined,
  };
}

const metadata = {
  id: CONV,
  clinicId: CLINIC_X,
  clinicNome: 'Clínica Aurora',
  status: 'active',
  messages: [toMessageMeta(row())],
};

const values = vi.fn();
const insert = vi.fn(() => ({ values }));
const tx = { insert };

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdmin.mockResolvedValue(undefined);
  requireUser.mockResolvedValue(superAdmin(CLINIC_X));
  transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
  values.mockResolvedValue(undefined);
  requestContext.mockResolvedValue({ ip: '203.0.113.7', userAgent: 'vitest', requestId: 'req-1' });
  decryptForTenant.mockResolvedValue(SECRET_TEXT);
  getMetadata.mockResolvedValue(metadata);
  findContentRowsTx.mockResolvedValue({ conversation: head, rows: [row()] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const auditRows = () => values.mock.calls.map(([v]) => v as Record<string, unknown>);

describe('abertura de conversa no console (S-01)', () => {
  it('sessão de suporte da MESMA clínica: devolve o texto e grava um evento sem conteúdo', async () => {
    const result = await openConversationForAdmin(CLINIC_X, CONV);

    expect(result.kind).toBe('content');
    if (result.kind !== 'content') throw new Error('unreachable');
    expect(result.conversation.messages[0]?.text).toBe(SECRET_TEXT);
    expect(findContentRowsTx).toHaveBeenCalledWith(tx, CLINIC_X, CONV);
    expect(decryptForTenant).toHaveBeenCalledWith(CLINIC_X, CIPHERTEXT);
    expect(getMetadata).not.toHaveBeenCalled();

    expect(auditRows()).toEqual([
      {
        superAdminId: 'admin-1',
        action: CONVERSATION_CONTENT_VIEWED,
        targetClinicId: CLINIC_X,
        payload: {
          conversationId: CONV,
          impersonationId: IMP,
          surface: 'admin_conversas_ia',
          messageCount: 1,
          decryptFailures: 0,
          requestId: 'req-1',
        },
        ipAddress: '203.0.113.7',
        userAgent: 'vitest',
      },
    ]);
    const trail = JSON.stringify(auditRows());
    expect(trail).not.toContain(SECRET_TEXT);
    expect(trail).not.toContain(CIPHERTEXT);
    expect(JSON.stringify(result)).not.toContain(CIPHERTEXT);
  });

  it('sem sessão (ausente, vencida ou revogada): só metadado, nada decifrado, nada gravado', async () => {
    // `resolveImpersonation` só devolve sessão ativa — vencida ou revogada
    // chega aqui exatamente como ausência de sessão.
    requireUser.mockResolvedValue(superAdmin());

    const result = await openConversationForAdmin(CLINIC_X, CONV);

    expect(result).toEqual({
      kind: 'metadata',
      reason: 'no_support_session',
      conversation: metadata,
    });
    expect(decryptForTenant).not.toHaveBeenCalled();
    expect(findContentRowsTx).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('admin.conversation.metadata_only', {
      targetClinicId: CLINIC_X,
      reason: 'no_support_session',
    });
  });

  it('sessão de OUTRA clínica: só metadado, nada decifrado, nada gravado', async () => {
    requireUser.mockResolvedValue(superAdmin(CLINIC_Y));

    const result = await openConversationForAdmin(CLINIC_X, CONV);

    expect(result).toMatchObject({ kind: 'metadata', reason: 'other_clinic_session' });
    expect(decryptForTenant).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it('ids adulterados (conversa de outra clínica) com sessão: não encontrada, nada decifrado nem gravado', async () => {
    findContentRowsTx.mockResolvedValue(null);

    await expect(openConversationForAdmin(CLINIC_X, CONV)).resolves.toEqual({ kind: 'not_found' });
    expect(decryptForTenant).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it('conversa inexistente sem sessão: não encontrada, sem métrica de metadado', async () => {
    requireUser.mockResolvedValue(superAdmin());
    getMetadata.mockResolvedValue(null);

    await expect(openConversationForAdmin(CLINIC_X, CONV)).resolves.toEqual({ kind: 'not_found' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('fail-closed: se o evento não grava, a abertura falha e o texto não sai', async () => {
    values.mockRejectedValue(new Error('insert failed'));

    await expect(openConversationForAdmin(CLINIC_X, CONV)).rejects.toThrow('insert failed');
  });

  it('falha de decifragem: placeholder, contagem no evento, nada do ciphertext', async () => {
    findContentRowsTx.mockResolvedValue({
      conversation: head,
      rows: [row(), row({ id: 'msg-2', direction: 'out' })],
    });
    decryptForTenant
      .mockResolvedValueOnce(SECRET_TEXT)
      .mockRejectedValueOnce(new Error('auth tag mismatch'));

    const result = await openConversationForAdmin(CLINIC_X, CONV);

    if (result.kind !== 'content') throw new Error('unreachable');
    expect(result.conversation.messages.map((m) => m.text)).toEqual([
      SECRET_TEXT,
      UNAVAILABLE_TEXT,
    ]);
    expect(auditRows()[0]).toMatchObject({ payload: { messageCount: 2, decryptFailures: 1 } });
    expect(JSON.stringify([result, auditRows()])).not.toContain(CIPHERTEXT);
    expect(JSON.stringify(auditRows())).not.toContain('auth tag');
  });

  it('super_admin sem AAL2 (ou sem o papel): nada é consultado', async () => {
    requireSuperAdmin.mockRejectedValue(new Error('MFA_REQUIRED'));

    await expect(openConversationForAdmin(CLINIC_X, CONV)).rejects.toThrow('MFA_REQUIRED');
    expect(getMetadata).not.toHaveBeenCalled();
    expect(findContentRowsTx).not.toHaveBeenCalled();
    expect(decryptForTenant).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('cada abertura grava o seu evento (duas abas ao mesmo tempo)', async () => {
    await Promise.all([
      openConversationForAdmin(CLINIC_X, CONV),
      openConversationForAdmin(CLINIC_X, CONV),
    ]);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledTimes(2);
  });

  it('nenhum log com texto ou ciphertext, no sucesso nem nas falhas', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    await openConversationForAdmin(CLINIC_X, CONV);
    decryptForTenant.mockRejectedValueOnce(new Error(`bad ${CIPHERTEXT}`));
    await openConversationForAdmin(CLINIC_X, CONV);
    values.mockRejectedValueOnce(new Error('insert failed'));
    await openConversationForAdmin(CLINIC_X, CONV).catch(() => undefined);

    const logged = JSON.stringify([...spies.map((s) => s.mock.calls), emit.mock.calls]);
    expect(logged).not.toContain(SECRET_TEXT);
    expect(logged).not.toContain(CIPHERTEXT);
  });

  it('autoria: paciente, IA, equipe pelo painel e equipe pelo WhatsApp Business', async () => {
    findContentRowsTx.mockResolvedValue({
      conversation: head,
      rows: [
        row({ id: 'a' }),
        row({ id: 'b', direction: 'out' }),
        row({ id: 'c', direction: 'out', sentByUserId: 'staff-1' }),
        row({ id: 'd', direction: 'out', sentViaBusinessApp: true }),
      ],
    });

    const result = await openConversationForAdmin(CLINIC_X, CONV);

    if (result.kind !== 'content') throw new Error('unreachable');
    expect(result.conversation.messages.map((m) => m.author)).toEqual([
      'patient',
      'agent',
      'human',
      'business_app',
    ]);
  });
});

describe('metadado de mensagem (modo sem sessão)', () => {
  it('não carrega texto nem ciphertext e só o NOME das tools', () => {
    const meta = toMessageMeta(
      row({
        direction: 'out',
        intent: 'prepare_appointment',
        model: 'gemini-2.5-flash',
        latencyMs: 812,
        toolCalls: [{ name: 'prepare_appointment', args: { nome: 'Fulana', cpf: '00000000000' } }],
      }),
    );

    expect(meta).toEqual({
      id: 'msg-1',
      direction: 'out',
      author: 'agent',
      intent: 'prepare_appointment',
      toolNames: ['prepare_appointment'],
      model: 'gemini-2.5-flash',
      latencyMs: 812,
      createdAt: '2026-11-15T12:00:00.000Z',
    });
    expect(JSON.stringify(meta)).not.toContain('Fulana');
  });
});

// ─── Gate estático ──────────────────────────────────────────────────────────
// O leitor auditado só vale se o próximo leitor não nascer ao lado dele sem
// trilha. Lista fechada: entrar nela exige commit e revisão.

const ROOT = process.cwd();
const ADMIN_DIR = path.join(ROOT, 'src/app/(admin)');
const READER = 'src/app/(admin)/admin/_lib/conversation-content.ts';
const REPO = 'src/app/(admin)/admin/_lib/repositories/conversations.repo.ts';
const PAGE = 'src/app/(admin)/admin/conversas-ia/page.tsx';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const adminFiles = walk(ADMIN_DIR).map((file) => ({
  id: path.relative(ROOT, file).split(path.sep).join('/'),
  content: readFileSync(file, 'utf8'),
}));

const usesDecrypt = (content: string): boolean =>
  /import\s[^;]*\bdecrypt\w*[^;]*from\s+['"]@\/lib\/crypto['"]/s.test(content) ||
  /\bdecrypt\w*\s*\(/.test(content);

describe('gate: conteúdo decifrado no console só pelos caminhos aprovados (ADR-073)', () => {
  it('o scan encontra o painel (não é vácuo)', () => {
    expect(adminFiles.length).toBeGreaterThan(10);
    expect(adminFiles.map((f) => f.id)).toEqual(expect.arrayContaining([READER, REPO, PAGE]));
  });

  it('só o leitor auditado e o CNPJ da clínica decifram dentro do (admin)', () => {
    const allowed = new Set([
      READER,
      // A8: CNPJ da própria clínica (dado cadastral da cliente, não do paciente).
      'src/app/(admin)/admin/_lib/repositories/clinics.repo.ts',
    ]);
    const offenders = adminFiles.filter((f) => !allowed.has(f.id) && usesDecrypt(f.content));
    expect(offenders.map((f) => f.id)).toEqual([]);
  });

  it('só o leitor auditado alcança as linhas com ciphertext da conversa', () => {
    const allowed = new Set([READER, REPO]);
    const offenders = adminFiles.filter(
      (f) =>
        !allowed.has(f.id) &&
        (f.content.includes('findContentRowsTx') || f.content.includes('contentEncrypted')),
    );
    expect(offenders.map((f) => f.id)).toEqual([]);
  });

  it('o leitor antigo sem trilha não volta', () => {
    expect(adminFiles.find((f) => f.id === REPO)?.content).not.toMatch(/\bgetDetail\s*\(/);
    expect(
      adminFiles.filter((f) => f.content.includes('conversationsRepository.getDetail')),
    ).toEqual([]);
  });

  it('a página abre conversa pelo leitor auditado e nenhum link faz prefetch', () => {
    const page = adminFiles.find((f) => f.id === PAGE)?.content ?? '';
    expect(page).toContain('openConversationForAdmin(');
    expect(usesDecrypt(page)).toBe(false);
    expect(page).not.toContain('findContentRowsTx');

    const links = page.match(/<Link\b/g) ?? [];
    const withoutPrefetch = page.match(/prefetch=\{false\}/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    expect(withoutPrefetch.length).toBe(links.length);
  });
});
