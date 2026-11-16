import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S-01b / ADR-074 — leitura de conversa pelas telas da clínica.
 *
 * Unidade, com `recordSupportConversationView`, `logAudit`,
 * `recordImpersonationAudit` e `sanitizePayload` REAIS e tx sintética:
 * equipe sem trilha, sessão de suporte com trilha da clínica uma vez por
 * sessão, conversa inexistente, fail-closed, cross-reference best-effort,
 * aberturas simultâneas, nada de conteúdo na trilha, e a lista consciente da
 * sessão. Gate estático no fim: as telas só leem conversa por este módulo.
 */

const {
  requireUser,
  withTenant,
  requestContext,
  emit,
  listConversations,
  loadConversationThreadTx,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withTenant: vi.fn(),
  requestContext: vi.fn(),
  emit: vi.fn(),
  listConversations: vi.fn(),
  loadConversationThreadTx: vi.fn(),
}));

const { platformValues } = vi.hoisted(() => ({ platformValues: vi.fn() }));

vi.mock('@/lib/auth/tenant-context', () => ({ requireUser }));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({ requestContext }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
// O cross-reference da plataforma (`recordImpersonationAudit`) é REAL: só o
// pool de serviço é trocado, para o teste ver o que ele grava e a falha dele.
vi.mock('@/lib/db', () => ({
  dbAdmin: { insert: vi.fn(() => ({ values: platformValues })) },
}));
vi.mock('./queries', () => ({ listConversations, loadConversationThreadTx }));

import { SUPPORT_CONVERSATION_VIEWED } from '@/lib/audit/support-conversation-view';

import { listConversationsForViewer, readConversationThread } from './conversation-access';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const CONV = '33333333-3333-4333-8333-333333333333';
const IMP = '44444444-4444-4444-8444-444444444444';
const ADMIN = '55555555-5555-4555-8555-555555555555';
const SECRET_TEXT = 'Estou com dor no peito desde ontem';
const PHONE = '+5511999991234';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const thread = {
  id: CONV,
  patientDisplayName: 'Ana',
  maskedPhone: '+5511*****1234',
  contactPhone: PHONE,
  contactName: null,
  status: 'handoff',
  intentAtual: null,
  startedAt: '2026-11-15T11:00:00.000Z',
  lastMessageAt: '2026-11-15T12:00:00.000Z',
  messages: [{ id: 'm1', direction: 'in', author: 'patient', text: SECRET_TEXT }],
  handoff: null,
  window: { open: true, lastInboundAt: null, closesAt: null },
};

function staff() {
  return { userId: 'user-1', isSuperAdmin: false, aal: 'aal1', session: undefined };
}

function support() {
  return {
    userId: ADMIN,
    isSuperAdmin: true,
    aal: 'aal2',
    session: {
      impersonation: {
        impersonationId: IMP,
        clinicId: CLINIC,
        startedAt: '2026-11-15T11:30:00.000Z',
      },
    },
  };
}

// Tx sintética da clínica: a consulta "já registrada nesta sessão" e o INSERT.
const alreadyInSession: Array<{ id: string }> = [];
const clinicValues = vi.fn();
const tx = {
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => alreadyInSession }) }),
  })),
  insert: vi.fn(() => ({ values: clinicValues })),
};

beforeEach(() => {
  vi.clearAllMocks();
  alreadyInSession.length = 0;
  requireUser.mockResolvedValue(support());
  withTenant.mockImplementation(async (_clinicId: string, fn: (t: typeof tx) => unknown) => fn(tx));
  requestContext.mockResolvedValue({ ip: '203.0.113.7', userAgent: 'vitest', requestId: 'req-1' });
  loadConversationThreadTx.mockResolvedValue(thread);
  clinicValues.mockResolvedValue(undefined);
  platformValues.mockResolvedValue(undefined);
  listConversations.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 30 });
});

const clinicRows = () => clinicValues.mock.calls.map(([v]) => v as Record<string, unknown>);
const platformRows = () => platformValues.mock.calls.map(([v]) => v as Record<string, unknown>);

describe('readConversationThread (S-01b)', () => {
  it('equipe da clínica: lê como sempre, sem trilha de leitura', async () => {
    requireUser.mockResolvedValue(staff());

    await expect(readConversationThread(CLINIC, CONV, 'conversas_inbox')).resolves.toBe(thread);

    expect(loadConversationThreadTx).toHaveBeenCalledWith(tx, CLINIC, CONV);
    expect(tx.select).not.toHaveBeenCalled();
    expect(clinicValues).not.toHaveBeenCalled();
    expect(platformValues).not.toHaveBeenCalled();
  });

  it('sessão de suporte, 1ª abertura: trilha da clínica na mesma tx, com o suporte como ator', async () => {
    await expect(readConversationThread(CLINIC, CONV, 'conversas_inbox')).resolves.toBe(thread);

    expect(clinicRows()).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(UUID),
        clinicId: CLINIC,
        userId: ADMIN,
        action: SUPPORT_CONVERSATION_VIEWED,
        resourceType: 'ai_conversation',
        resourceId: CONV,
        before: null,
        after: { surface: 'conversas_inbox', impersonationId: IMP, messageCount: 1 },
      }),
    ]);
    // Cross-reference na trilha da plataforma, apontando para a linha da clínica.
    expect(platformRows()).toEqual([
      expect.objectContaining({
        superAdminId: ADMIN,
        action: 'impersonate_mutation',
        targetClinicId: CLINIC,
        payload: {
          impersonationId: IMP,
          auditEventId: clinicRows()[0]?.id,
          action: SUPPORT_CONVERSATION_VIEWED,
          resourceType: 'ai_conversation',
          resourceId: CONV,
        },
      }),
    ]);
  });

  it('a mesma sessão já registrou esta conversa: refresh e reabertura não repetem nada', async () => {
    alreadyInSession.push({ id: 'audit-1' });

    await expect(readConversationThread(CLINIC, CONV, 'conversa_direta')).resolves.toBe(thread);

    expect(clinicValues).not.toHaveBeenCalled();
    expect(platformValues).not.toHaveBeenCalled();
  });

  it('conversa inexistente ou de outra clínica: null, nada registrado', async () => {
    loadConversationThreadTx.mockResolvedValue(null);

    await expect(readConversationThread(CLINIC, CONV, 'conversas_inbox')).resolves.toBeNull();

    expect(tx.select).not.toHaveBeenCalled();
    expect(clinicValues).not.toHaveBeenCalled();
    expect(platformValues).not.toHaveBeenCalled();
  });

  it('fail-closed: se a trilha da clínica não grava, a leitura falha e o histórico não sai', async () => {
    clinicValues.mockRejectedValue(new Error('audit_events insert failed'));

    await expect(readConversationThread(CLINIC, CONV, 'conversas_inbox')).rejects.toThrow(
      'audit_events insert failed',
    );
    expect(platformValues).not.toHaveBeenCalled();
  });

  it('cross-reference é best-effort: se a plataforma falha, a leitura segue e a falha vira métrica', async () => {
    platformValues.mockRejectedValue(new Error('super_admin_actions down'));

    await expect(readConversationThread(CLINIC, CONV, 'conversas_inbox')).resolves.toBe(thread);

    expect(clinicValues).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith('super_admin.impersonate_audit_failed', {
      targetClinicId: CLINIC,
    });
  });

  it('duas aberturas simultâneas: no máximo duas linhas, sem erro (duplicata aceita, nunca lacuna)', async () => {
    await Promise.all([
      readConversationThread(CLINIC, CONV, 'conversas_inbox'),
      readConversationThread(CLINIC, CONV, 'conversas_inbox'),
    ]);

    expect(clinicValues.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(clinicValues.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('nenhum texto, telefone ou nome nas trilhas', async () => {
    await readConversationThread(CLINIC, CONV, 'conversas_inbox');

    const trails = JSON.stringify([clinicRows(), platformRows(), emit.mock.calls]);
    expect(trails).not.toContain(SECRET_TEXT);
    expect(trails).not.toContain('5511999991234');
    expect(trails).not.toContain('Ana');
  });
});

describe('listConversationsForViewer (S-01b)', () => {
  it('equipe da clínica: lista como sempre', async () => {
    requireUser.mockResolvedValue(staff());

    const result = await listConversationsForViewer(CLINIC, { page: 2 });

    expect(listConversations).toHaveBeenCalledWith(CLINIC, { page: 2 });
    expect(result.supportSession).toBe(false);
  });

  it('sessão de suporte: pede a lista sem prévia e com telefone mascarado', async () => {
    const result = await listConversationsForViewer(CLINIC, { status: 'handoff' });

    expect(listConversations).toHaveBeenCalledWith(CLINIC, {
      status: 'handoff',
      redactForSupport: true,
    });
    expect(result.supportSession).toBe(true);
  });
});

// ─── Gate estático ──────────────────────────────────────────────────────────
// As telas só leem conversa por este módulo. Quem lê a thread ou a lista
// direto de `queries.ts` pula a trilha do suporte — lista fechada de arquivos.

const ROOT = process.cwd();
const ACCESS = 'src/contexts/ai-agent/conversation-access.ts';
const QUERIES = 'src/contexts/ai-agent/queries.ts';
const INBOX = 'src/app/(app)/(shell)/conversas/page.tsx';
const DIRECT = 'src/app/(app)/(shell)/conversas/[id]/page.tsx';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sources = walk(path.join(ROOT, 'src')).map((file) => ({
  id: path.relative(ROOT, file).split(path.sep).join('/'),
  content: readFileSync(file, 'utf8'),
}));

describe('gate: as telas leem conversa só pelo leitor que conhece a sessão de suporte (ADR-074)', () => {
  it('o scan encontra o código (não é vácuo)', () => {
    expect(sources.map((s) => s.id)).toEqual(
      expect.arrayContaining([ACCESS, QUERIES, INBOX, DIRECT]),
    );
  });

  it('só o leitor auditado chama a leitura crua da thread e da lista', () => {
    const allowed = new Set([ACCESS, QUERIES]);
    const offenders = sources.filter(
      (s) =>
        !allowed.has(s.id) &&
        /\b(getConversationThread|loadConversationThreadTx|listConversations)\b/.test(s.content),
    );
    expect(offenders.map((s) => s.id)).toEqual([]);
  });

  it('as duas telas de conversa usam o leitor auditado', () => {
    for (const id of [INBOX, DIRECT]) {
      const page = sources.find((s) => s.id === id)?.content ?? '';
      expect(page).toContain("from '@/contexts/ai-agent/conversation-access'");
      expect(page).toContain('readConversationThread(');
    }
    expect(sources.find((s) => s.id === INBOX)?.content).toContain('listConversationsForViewer(');
  });
});
