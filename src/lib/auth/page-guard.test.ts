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

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const { pageGate, requirePageUser, resourceGate } = await import('./page-guard');

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

describe('requirePageUser', () => {
  it.each(['TOKEN_INVALID', 'CLAIMS_OUTDATED', 'USER_DISABLED', 'USER_DELETED'])(
    'sessão %s vira ida ao /login, não AuthError (OBS-001)',
    async (reason) => {
      authenticate.mockResolvedValue({ ok: false, reason });
      await expect(requirePageUser()).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledWith('/login');
    },
  );

  it('devolve a mesma identidade de requireUser quando a sessão vale', async () => {
    authenticate.mockResolvedValue(identity({ permissions: [PERMISSIONS.VIEW_AGENDA] }));
    const user = await requirePageUser();
    expect(user.userId).toBe('u1');
    expect(user.permissions).toEqual([PERMISSIONS.VIEW_AGENDA]);
    expect(redirect).not.toHaveBeenCalled();
  });
});

/*
  Contrato estático: nenhuma página do shell lê o usuário com `requireUser()` no render (com a
  sessão morta, ele lança e a tela vira "Algo deu errado"). A exceção é a de Assinatura, que o
  PR #53 (billing) está alterando: a troca fica com ele (docs/otimização_ui_final.md, 32).
*/
describe('páginas do shell', () => {
  const shell = resolve(process.cwd(), 'src/app/(app)/(shell)');
  const PENDENTES_DE_OUTRO_PR = new Set(['configuracoes/assinatura/page.tsx']);

  function pages(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return pages(path);
      return entry.name === 'page.tsx' ? [path] : [];
    });
  }

  it('leem o usuário por requirePageUser, pageGate ou getCurrentUser, nunca requireUser no render', () => {
    const offenders = pages(shell)
      .map((path) =>
        path
          .slice(shell.length + 1)
          .split(sep)
          .join('/'),
      )
      .filter((relative) => !PENDENTES_DE_OUTRO_PR.has(relative))
      .filter((relative) =>
        readFileSync(join(shell, relative), 'utf8').includes('await requireUser()'),
      );
    expect(offenders).toEqual([]);
  });
});
