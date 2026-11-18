/**
 * P1.13 — contrato de plataforma: só o super admin (AAL2) liga ou lista; ligar exige a
 * disponibilidade comercial `true` literal; motivo obrigatório; cada chamada fica em
 * `super_admin_actions`. O banco (ligar uma clínica não toca outra, D24, trilha da clínica) está
 * provado em scripts/security/health-insurance-platform-db.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  requireUser: vi.fn(),
  superAdminAction: vi.fn(),
  getPlatformSetting: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/tenant-context', () => ({ requireSuperAdmin: m.requireSuperAdmin, requireUser: m.requireUser }));
vi.mock('@/lib/audit/super-admin', () => ({ superAdminAction: m.superAdminAction }));
vi.mock('@/lib/platform-settings', () => ({ getPlatformSetting: m.getPlatformSetting }));
vi.mock('@/lib/audit/log', () => ({ logAudit: vi.fn() }));

import {
  CONVENIOS_AVAILABILITY_KEY,
  ConveniosPlatformError,
  isConveniosAvailableOnPlatform,
  listConveniosModuleStates,
  setConveniosModuleForClinic,
} from './platform';

const rc = { ip: null, userAgent: null, requestId: 'req-1', correlationId: null } as never;
const CLINIC = '00000000-0000-4000-8000-0000000000c1';

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSuperAdmin.mockResolvedValue(undefined);
  m.requireUser.mockResolvedValue({ userId: '00000000-0000-4000-8000-00000000a001', isSuperAdmin: true });
  m.superAdminAction.mockImplementation(async (_opts: unknown, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn().mockResolvedValue([]) }));
});

describe('disponibilidade comercial (D8: nada ligado por padrão)', () => {
  it('só `true` literal libera; ausência, texto ou erro mantêm desligado', async () => {
    for (const [value, expected] of [[true, true], [false, false], ['true', false], [1, false], [undefined, false]] as const) {
      m.getPlatformSetting.mockResolvedValueOnce(value === undefined ? false : value);
      expect(await isConveniosAvailableOnPlatform()).toBe(expected);
    }
    expect(m.getPlatformSetting).toHaveBeenCalledWith(CONVENIOS_AVAILABILITY_KEY, false);
  });
});

describe('ligar e desligar pela plataforma', () => {
  it('sem super admin (ou sem AAL2), recusa antes de ler qualquer coisa', async () => {
    m.requireSuperAdmin.mockRejectedValueOnce(new Error('Requer super_admin'));
    await expect(setConveniosModuleForClinic({ clinicId: CLINIC, enabled: true, reason: 'piloto aprovado' }, rc)).rejects.toThrow(/super_admin/u);
    expect(m.getPlatformSetting).not.toHaveBeenCalled();
    expect(m.superAdminAction).not.toHaveBeenCalled();
  });

  it('ligar com a disponibilidade comercial desligada é recusado e nada é gravado', async () => {
    m.getPlatformSetting.mockResolvedValueOnce(false);
    await expect(setConveniosModuleForClinic({ clinicId: CLINIC, enabled: true, reason: 'piloto aprovado' }, rc)).rejects.toMatchObject({
      name: 'ConveniosPlatformError',
      code: 'unavailable',
    });
    expect(m.superAdminAction).not.toHaveBeenCalled();
  });

  it('desligar não depende da disponibilidade (sempre é possível conter)', async () => {
    m.superAdminAction.mockImplementationOnce(async (_opts: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: vi.fn().mockResolvedValueOnce([{ id: CLINIC }]).mockResolvedValueOnce([]) }),
    );
    const out = await setConveniosModuleForClinic({ clinicId: CLINIC, enabled: false, reason: 'contenção de incidente' }, rc);
    expect(m.getPlatformSetting).not.toHaveBeenCalled();
    expect(m.superAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'health_insurance.module.disable', targetClinicId: CLINIC, payload: { enabled: false, reason: 'contenção de incidente' } }),
      expect.any(Function),
    );
    // Sem linha de configuração, desligar é idempotente (nada a mudar).
    expect(out).toEqual({ clinicId: CLINIC, enabled: false, changed: false });
  });

  it('motivo e clínica são obrigatórios (erro de dados, sem chamar o banco)', async () => {
    await expect(setConveniosModuleForClinic({ clinicId: CLINIC, enabled: false, reason: 'x' }, rc)).rejects.toBeInstanceOf(ConveniosPlatformError);
    await expect(setConveniosModuleForClinic({ clinicId: 'não-é-uuid', enabled: false, reason: 'motivo válido' }, rc)).rejects.toMatchObject({ code: 'invalid' });
    expect(m.superAdminAction).not.toHaveBeenCalled();
  });

  it('clínica inexistente: erro conhecido, sem detalhe interno', async () => {
    m.getPlatformSetting.mockResolvedValueOnce(true);
    await expect(setConveniosModuleForClinic({ clinicId: CLINIC, enabled: true, reason: 'piloto aprovado' }, rc)).rejects.toMatchObject({
      code: 'not_found',
      message: 'Clínica não encontrada.',
    });
  });
});

describe('lista para o console', () => {
  it('exige super admin e registra a leitura em super_admin_actions', async () => {
    m.getPlatformSetting.mockResolvedValueOnce(false);
    const out = await listConveniosModuleStates({ limit: 10 }, rc);
    expect(out).toEqual({ available: false, clinics: [] });
    expect(m.requireSuperAdmin).toHaveBeenCalled();
    expect(m.superAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'health_insurance.module.states_read', targetClinicId: null }),
      expect.any(Function),
    );
  });
});
