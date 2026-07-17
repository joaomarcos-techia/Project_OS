/**
 * Ciclo de vida de membro (I-2). Testa os GUARD-RAILS e a AUDITORIA — a parte que,
 * se quebrar, vira incidente de segurança (alguém se auto-desativa, um owner é
 * derrubado, uma mudança de acesso não deixa rastro).
 *
 * Mock: dbAdmin (leitura do alvo + transação) e logAudit. O que importa é o
 * COMPORTAMENTO (qual erro, qual ação auditada), não o SQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, logAudit } = vi.hoisted(() => ({
  db: { target: null as null | { role: string; ativo: boolean }, overrideBefore: [] as unknown[] },
  logAudit: vi.fn(async (_tx: unknown, _args: Record<string, unknown>) => 'audit-id'),
}));

/** Chain do Drizzle que resolve `limit()` com o valor dado. */
function selectChain(result: unknown[]) {
  const p: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where']) p[m] = () => p;
  p.limit = () => Promise.resolve(result);
  return p;
}

/** update/insert/delete: encadeáveis e resolvem em no-op. */
function writeChain() {
  const p: Record<string, unknown> = {};
  for (const m of ['set', 'where', 'values', 'onConflictDoUpdate']) p[m] = () => p;
  // torna o objeto "await-able" (as writes são `await tx.update()...`)
  (p as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(undefined);
  return p;
}

vi.mock('@/lib/db', () => {
  const txLike = {
    select: () => selectChain(db.overrideBefore),
    update: () => writeChain(),
    insert: () => writeChain(),
    delete: () => writeChain(),
  };
  return {
    dbAdmin: {
      select: () => selectChain(db.target ? [db.target] : []),
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(txLike),
    },
  };
});

vi.mock('@/lib/audit/log', () => ({ logAudit }));

import { setMemberActive, setMemberOverride, setMemberRole } from './lifecycle';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';
const TARGET = '33333333-3333-3333-3333-333333333333';
const ctx = { ip: '127.0.0.1', userAgent: 'test', requestId: 'req-1', correlationId: 'req-1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.target = { role: 'attendant', ativo: true };
  db.overrideBefore = [];
});

describe('setMemberActive', () => {
  it('não deixa o ator desativar a si mesmo', async () => {
    await expect(
      setMemberActive({
        clinicId: CLINIC,
        actorUserId: ACTOR,
        targetUserId: ACTOR,
        active: false,
        requestContext: ctx,
      }),
    ).rejects.toMatchObject({ code: 'self_mutation_forbidden' });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('alvo inexistente → MemberNotFoundError', async () => {
    db.target = null;
    await expect(
      setMemberActive({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, active: false, requestContext: ctx }),
    ).rejects.toMatchObject({ code: 'member_not_found' });
  });

  it.each(['owner', 'super_admin'])('não desativa papel protegido (%s)', async (role) => {
    db.target = { role, ativo: true };
    await expect(
      setMemberActive({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, active: false, requestContext: ctx }),
    ).rejects.toMatchObject({ code: 'protected_role' });
  });

  it('desativa: audita como `deactivated`, before/after corretos', async () => {
    db.target = { role: 'doctor', ativo: true };
    await setMemberActive({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, active: false, requestContext: ctx });
    expect(logAudit).toHaveBeenCalledOnce();
    expect(logAudit.mock.calls[0]![1]).toMatchObject({
      action: 'internal.user.deactivated',
      resourceId: TARGET,
      before: { ativo: true },
      after: { ativo: false },
    });
  });

  it('override de agenda futura entra no after da auditoria (rastreável)', async () => {
    db.target = { role: 'doctor', ativo: true };
    await setMemberActive({
      clinicId: CLINIC,
      actorUserId: ACTOR,
      targetUserId: TARGET,
      active: false,
      forcedOverCommitments: { futureCount: 3, openCount: 1 },
      requestContext: ctx,
    });
    expect(logAudit.mock.calls[0]![1]).toMatchObject({
      after: { ativo: false, forcedOverCommitments: { futureCount: 3, openCount: 1 } },
    });
  });

  it('reativar: audita como `reactivated`', async () => {
    db.target = { role: 'doctor', ativo: false };
    await setMemberActive({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, active: true, requestContext: ctx });
    expect(logAudit.mock.calls[0]![1]).toMatchObject({ action: 'internal.user.reactivated' });
  });

  it('idempotente: já no estado pedido → no-op sem auditar', async () => {
    db.target = { role: 'doctor', ativo: true };
    await setMemberActive({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, active: true, requestContext: ctx });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe('setMemberRole', () => {
  it('não deixa trocar o próprio papel', async () => {
    await expect(
      setMemberRole({ clinicId: CLINIC, actorUserId: ACTOR, actorRole: 'owner', targetUserId: ACTOR, newRole: 'gestor', requestContext: ctx }),
    ).rejects.toMatchObject({ code: 'self_mutation_forbidden' });
  });

  it('não rebaixa owner (papel protegido)', async () => {
    db.target = { role: 'owner', ativo: true };
    await expect(
      setMemberRole({ clinicId: CLINIC, actorUserId: ACTOR, actorRole: 'owner', targetUserId: TARGET, newRole: 'gestor', requestContext: ctx }),
    ).rejects.toMatchObject({ code: 'protected_role' });
  });

  it('anti-escalonamento: não PROMOVE a owner', async () => {
    db.target = { role: 'attendant', ativo: true };
    await expect(
      setMemberRole({ clinicId: CLINIC, actorUserId: ACTOR, actorRole: 'owner', targetUserId: TARGET, newRole: 'owner', requestContext: ctx }),
    ).rejects.toMatchObject({ code: 'role_assignment_forbidden' });
  });

  it('troca válida: audita before/after do role', async () => {
    db.target = { role: 'attendant', ativo: true };
    await setMemberRole({ clinicId: CLINIC, actorUserId: ACTOR, actorRole: 'owner', targetUserId: TARGET, newRole: 'financial', requestContext: ctx });
    expect(logAudit.mock.calls[0]![1]).toMatchObject({
      action: 'internal.user.role_changed',
      before: { role: 'attendant' },
      after: { role: 'financial' },
    });
  });

  it('mesmo role → no-op', async () => {
    db.target = { role: 'financial', ativo: true };
    await setMemberRole({ clinicId: CLINIC, actorUserId: ACTOR, actorRole: 'owner', targetUserId: TARGET, newRole: 'financial', requestContext: ctx });
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe('setMemberOverride', () => {
  it('não deixa o ator mexer nos próprios overrides (anti auto-escalonamento)', async () => {
    await expect(
      setMemberOverride({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: ACTOR, permissionCode: 'manage:employees', granted: true, requestContext: ctx }),
    ).rejects.toMatchObject({ code: 'self_mutation_forbidden' });
  });

  it('não concede override em papel protegido', async () => {
    db.target = { role: 'owner', ativo: true };
    await expect(
      setMemberOverride({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, permissionCode: 'manage:employees', granted: true, requestContext: ctx }),
    ).rejects.toMatchObject({ code: 'protected_role' });
  });

  it('concede: audita a permissão + granted', async () => {
    db.target = { role: 'attendant', ativo: true };
    await setMemberOverride({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, permissionCode: 'view:financial', granted: true, requestContext: ctx });
    expect(logAudit.mock.calls[0]![1]).toMatchObject({
      action: 'internal.user.override_changed',
      after: { permission: 'view:financial', granted: true },
    });
  });

  it('remover (granted=null): audita a remoção', async () => {
    db.target = { role: 'attendant', ativo: true };
    db.overrideBefore = [{ granted: true }];
    await setMemberOverride({ clinicId: CLINIC, actorUserId: ACTOR, targetUserId: TARGET, permissionCode: 'view:financial', granted: null, requestContext: ctx });
    expect(logAudit.mock.calls[0]![1]).toMatchObject({
      before: { permission: 'view:financial', granted: true },
      after: { permission: 'view:financial', granted: null },
    });
  });
});
