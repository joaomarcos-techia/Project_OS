/**
 * Credenciais por operadora (P2.5/P2.1 do ciclo de 14/11) na camada de AÇÃO: permissão de
 * gestão antes de qualquer escrita, auditoria na mesma transação SEM o segredo, e o segredo
 * nunca em log, em mensagem de erro nem no resultado devolvido à tela. A cifra, a rotação, a
 * revogação e o isolamento entre clínicas estão provados em Postgres no harness
 * scripts/security/health-insurance-insurer-credentials-db.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireFreshPermission: vi.fn(),
  requireClinicId: vi.fn(),
  logAudit: vi.fn(),
  saveInsurerCredentialTx: vi.fn(),
  revokeInsurerCredentialTx: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/auth/tenant-context', async () => {
  class AuthError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  }
  return {
    AuthError,
    requireUser: m.requireUser,
    requireCachedPermission: m.requireCachedPermission,
    requireFreshPermission: m.requireFreshPermission,
    requireClinicId: m.requireClinicId,
  };
});
vi.mock('@/lib/audit/log', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/audit/request-context-from-headers', () => ({
  requestContext: async () => ({ ip: null, userAgent: null, requestId: 'r1' }),
}));
vi.mock('@/lib/db/tenant', () => ({
  withTenant: async (_c: string, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() }),
}));
vi.mock('./internal/insurer-credentials', () => ({
  saveInsurerCredentialTx: m.saveInsurerCredentialTx,
  revokeInsurerCredentialTx: m.revokeInsurerCredentialTx,
}));

import { AuthError } from '@/lib/auth/tenant-context';
import { PERMISSIONS } from '@/lib/auth/permissions';

import { revokeInsurerCredentialAction, saveInsurerCredentialAction } from './config-actions';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const INSURER = '33333333-3333-4333-8333-333333333333';
const CREDENTIAL = '44444444-4444-4444-8444-444444444444';
const SECRET = 'senha-sintetica-da-operadora-NUNCA-em-log-9f3a';

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
const printed = () =>
  spies.flatMap((s) =>
    s.mock.calls.map((c) =>
      c.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '),
    ),
  );

describe('ações de credencial da operadora', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireUser.mockResolvedValue({ userId: 'u1' });
    m.requireCachedPermission.mockResolvedValue(undefined);
    m.requireFreshPermission.mockResolvedValue(undefined);
    m.requireClinicId.mockResolvedValue(CLINIC);
    m.saveInsurerCredentialTx.mockResolvedValue({ credentialId: CREDENTIAL, rotated: true });
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(vi.spyOn(console, level).mockImplementation(() => undefined));
    }
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it('salvar exige gerenciar o financeiro, audita na mesma transação e nunca carrega o segredo', async () => {
    const r = await saveInsurerCredentialAction({
      insurerId: INSURER,
      kind: 'webservice_login',
      username: 'prestador-01',
      secret: SECRET,
    });
    expect(r).toEqual({ ok: true, data: { rotated: true } });
    expect(m.requireCachedPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_CONVENIOS);
    expect(m.saveInsurerCredentialTx).toHaveBeenCalledOnce();
    expect(m.logAudit).toHaveBeenCalledOnce();
    const audit = m.logAudit.mock.calls[0]![1];
    expect(audit).toMatchObject({
      action: 'health_insurance.config.insurer_credential_saved',
      resourceId: CREDENTIAL,
      after: { insurerId: INSURER, kind: 'webservice_login', rotated: true },
    });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(printed().join('\n')).not.toContain(SECRET);
  });

  it('sem permissão: recusa antes de tocar o segredo ou o banco', async () => {
    m.requireCachedPermission.mockRejectedValue(
      new AuthError('forbidden', 'forbidden', 403, 'PERMISSION_DENIED'),
    );
    const r = await saveInsurerCredentialAction({
      insurerId: INSURER,
      kind: 'webservice_login',
      secret: SECRET,
    });
    expect(r).toEqual({
      ok: false,
      error: 'Seu perfil não tem permissão para esta configuração de convênios.',
    });
    expect(m.saveInsurerCredentialTx).not.toHaveBeenCalled();
    expect(m.logAudit).not.toHaveBeenCalled();
  });

  it('falha no banco: mensagem genérica, sem eco do segredo, sem auditoria de sucesso', async () => {
    m.saveInsurerCredentialTx.mockRejectedValue(
      Object.assign(new Error(`falhou ao gravar ${SECRET}`), { code: 'XX000' }),
    );
    const r = await saveInsurerCredentialAction({
      insurerId: INSURER,
      kind: 'webservice_login',
      secret: SECRET,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(m.logAudit).not.toHaveBeenCalled();
    expect(printed().join('\n')).not.toContain(SECRET);
  });

  it('segredo curto é recusado pela validação sem ecoar o valor', async () => {
    const r = await saveInsurerCredentialAction({
      insurerId: INSURER,
      kind: 'webservice_login',
      secret: 'curta',
    });
    expect(r).toEqual({
      ok: false,
      error: 'A senha/certificado precisa ter pelo menos 8 caracteres.',
    });
    expect(m.saveInsurerCredentialTx).not.toHaveBeenCalled();
  });

  it('revogar exige gerenciar o financeiro e audita o novo estado', async () => {
    const r = await revokeInsurerCredentialAction({ insurerId: INSURER, credentialId: CREDENTIAL });
    expect(r).toEqual({ ok: true, data: null });
    expect(m.requireCachedPermission).toHaveBeenCalledWith(PERMISSIONS.MANAGE_CONVENIOS);
    expect(m.revokeInsurerCredentialTx).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC,
      insurerId: INSURER,
      credentialId: CREDENTIAL,
    });
    expect(m.logAudit.mock.calls[0]![1]).toMatchObject({
      action: 'health_insurance.config.insurer_credential_revoked',
      after: { insurerId: INSURER, status: 'revoked' },
    });
  });

  it('ids malformados são recusados antes do banco', async () => {
    const r = await revokeInsurerCredentialAction({ insurerId: 'x', credentialId: CREDENTIAL });
    expect(r.ok).toBe(false);
    expect(m.revokeInsurerCredentialTx).not.toHaveBeenCalled();
  });
});

describe('acesso à credencial cifrada (P12.5)', () => {
  it('só o módulo de credenciais cifra e só o adaptador SOAP decifra, na hora do envio (P6.5)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative, sep } = await import('node:path');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.(ts|tsx)$/u.test(name) && !/\.test\.(ts|tsx)$/u.test(name) ? [full] : [];
      });
    const root = process.cwd();
    const touching = walk(join(root, 'src'))
      .filter((f) => /secret_encrypted|secretEncrypted/u.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split(sep).join('/'))
      .sort();
    // O adaptador SOAP (P6.5) entra aqui de propósito — e só ele decifra, na hora do envio.
    expect(touching).toEqual([
      'src/contexts/health-insurance/internal/connectors/tiss-soap/credential.ts',
      'src/contexts/health-insurance/internal/insurer-credentials.ts',
      'src/contexts/health-insurance/schema-clinic.ts',
    ]);
    const credentialsSource = readFileSync(
      join(root, 'src/contexts/health-insurance/internal/insurer-credentials.ts'),
      'utf8',
    );
    expect(credentialsSource).not.toMatch(/decryptForTenant/u);
    // Sem operadora homologada (B5), nenhum código do app chama a leitura em claro.
    const callers = walk(join(root, 'src'))
      .filter((f) => /tiss-soap\/credential['"]|readWebserviceCredentialForSendTx/u.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split(sep).join('/'));
    expect(callers).toEqual(['src/contexts/health-insurance/internal/connectors/tiss-soap/credential.ts']);
  }, 60_000);
});
