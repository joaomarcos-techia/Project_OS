import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, logAudit } = vi.hoisted(() => ({
  db: {
    profile: null as null | {
      role: string;
      ativo: boolean;
      crm: string | null;
      crmUf: string | null;
      especialidade: string | null;
    },
    updateError: null as unknown,
  },
  logAudit: vi.fn(async () => 'audit-id'),
}));

function selectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'where']) chain[method] = () => chain;
  chain.limit = () => Promise.resolve(result);
  return chain;
}

function updateChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ['set', 'where']) chain[method] = () => chain;
  (chain as { then: unknown }).then = (
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void,
  ) => (db.updateError ? reject(db.updateError) : resolve(undefined));
  return chain;
}

vi.mock('@/lib/db/tenant', () => ({
  withTenant: (_clinicId: string, callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      select: () => selectChain(db.profile ? [db.profile] : []),
      update: () => updateChain(),
    }),
}));
vi.mock('@/lib/audit/log', () => ({ logAudit }));

import { updateOwnProfessionalCredential } from './professional-credential';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const ctx = {
  ip: '127.0.0.1',
  userAgent: 'test',
  requestId: 'req-1',
  correlationId: 'req-1',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.profile = { role: 'gestor', ativo: true, crm: null, crmUf: null, especialidade: null };
  db.updateError = null;
});

describe('updateOwnProfessionalCredential', () => {
  it('normaliza o CRM e audita a alteração do próprio gestor', async () => {
    await updateOwnProfessionalCredential({
      clinicId: CLINIC,
      userId: USER,
      crm: ' 12 345 a ',
      crmUf: ' sp ',
      especialidade: ' Cardiologia ',
      requestContext: ctx,
    });

    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'internal.user.credential_changed',
        resourceId: USER,
        before: { crm: null, crmUf: null, especialidade: null },
        after: { crm: '12345A', crmUf: 'SP', especialidade: 'Cardiologia' },
      }),
    );
  });

  it('bloqueia papel não clínico sem alterar nem auditar', async () => {
    db.profile = { role: 'attendant', ativo: true, crm: null, crmUf: null, especialidade: null };

    await expect(
      updateOwnProfessionalCredential({
        clinicId: CLINIC,
        userId: USER,
        crm: '12345',
        crmUf: 'SP',
        requestContext: ctx,
      }),
    ).rejects.toMatchObject({ code: 'professional_credential_invalid' });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('traduz CRM duplicado para erro de domínio', async () => {
    db.updateError = { code: '23505' };

    await expect(
      updateOwnProfessionalCredential({
        clinicId: CLINIC,
        userId: USER,
        crm: '12345',
        crmUf: 'SP',
        requestContext: ctx,
      }),
    ).rejects.toMatchObject({ code: 'crm_conflict' });
  });
});
