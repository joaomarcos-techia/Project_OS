import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from './permissions';

const authenticate = vi.fn();
const redirect = vi.fn((_to: string) => {
  // O `redirect()` do Next lança para abortar o render. Reproduzimos isso: sem
  // o throw, o teste veria o gate "continuar depois de redirecionar", que é
  // exatamente o bug que não queremos assinar.
  throw new Error('NEXT_REDIRECT');
});

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('./tenant-context', () => ({ authenticate: () => authenticate() }));

const { pageGate, resourceGate } = await import('./page-guard');

interface FakeUser {
  isSuperAdmin: boolean;
  aal: 'aal1' | 'aal2' | null;
  permissions: readonly string[];
  clinicId: string | null;
  session?: { impersonation?: { clinicId: string } };
}

function identity(over: Partial<FakeUser> = {}) {
  return {
    ok: true as const,
    identity: {
      userId: 'u1',
      isSuperAdmin: false,
      aal: 'aal1' as const,
      permissions: [] as readonly string[],
      clinicId: 'clinic-a',
      ...over,
    },
  };
}

beforeEach(() => {
  authenticate.mockReset();
  redirect.mockClear();
});

describe('pageGate', () => {
  it('redireciona para /login quando a sessão não é válida — não lança AuthError (OBS-001)', async () => {
    authenticate.mockResolvedValue({ ok: false, reason: 'CLAIMS_OUTDATED' });
    await expect(pageGate([PERMISSIONS.VIEW_PATIENT])).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('libera quando a permissão está presente e devolve o clinicId da sessão', async () => {
    authenticate.mockResolvedValue(identity({ permissions: [PERMISSIONS.VIEW_PATIENT] }));
    const gate = await pageGate([PERMISSIONS.VIEW_PATIENT]);
    expect(gate.allowed).toBe(true);
    if (gate.allowed) expect(gate.clinicId).toBe('clinic-a');
  });

  it('nega quando a permissão foi revogada, sem redirecionar', async () => {
    authenticate.mockResolvedValue(identity({ permissions: [PERMISSIONS.VIEW_AGENDA] }));
    const gate = await pageGate([PERMISSIONS.VIEW_PATIENT]);
    expect(gate.allowed).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('aceita OR: qualquer uma das permissões abre a tela', async () => {
    authenticate.mockResolvedValue(identity({ permissions: [PERMISSIONS.VIEW_PRONTUARIO] }));
    const gate = await pageGate([PERMISSIONS.VIEW_PRESCRIPTION, PERMISSIONS.VIEW_PRONTUARIO]);
    expect(gate.allowed).toBe(true);
  });

  it('super_admin em AAL2 bypassa RBAC; em AAL1 não (I-1)', async () => {
    authenticate.mockResolvedValue(identity({ isSuperAdmin: true, aal: 'aal2' }));
    expect((await pageGate([PERMISSIONS.VIEW_PATIENT])).allowed).toBe(true);

    authenticate.mockResolvedValue(identity({ isSuperAdmin: true, aal: 'aal1' }));
    expect((await pageGate([PERMISSIONS.VIEW_PATIENT])).allowed).toBe(false);
  });

  it('usa o clinicId da impersonação quando existe (C15)', async () => {
    authenticate.mockResolvedValue(
      identity({
        isSuperAdmin: true,
        aal: 'aal2',
        clinicId: null,
        session: { impersonation: { clinicId: 'clinic-b' } },
      }),
    );
    const gate = await pageGate([PERMISSIONS.VIEW_PATIENT]);
    expect(gate.allowed).toBe(true);
    if (gate.allowed) expect(gate.clinicId).toBe('clinic-b');
  });

  it('nega super_admin sem clínica selecionada em vez de consultar com clinicId nulo', async () => {
    authenticate.mockResolvedValue(identity({ isSuperAdmin: true, aal: 'aal2', clinicId: null }));
    expect((await pageGate([PERMISSIONS.VIEW_PATIENT])).allowed).toBe(false);
  });
});

describe('resourceGate', () => {
  it('devolve null no deny para o caller poder chamar notFound() (sem oráculo de enumeração)', async () => {
    authenticate.mockResolvedValue(identity({ permissions: [] }));
    expect(await resourceGate([PERMISSIONS.VIEW_PRESCRIPTION])).toBeNull();
  });

  it('devolve identidade e clínica quando autorizado', async () => {
    authenticate.mockResolvedValue(identity({ permissions: [PERMISSIONS.VIEW_PRESCRIPTION] }));
    const gate = await resourceGate([PERMISSIONS.VIEW_PRESCRIPTION]);
    expect(gate?.clinicId).toBe('clinic-a');
  });
});
