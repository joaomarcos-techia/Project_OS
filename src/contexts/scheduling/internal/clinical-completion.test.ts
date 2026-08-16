import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireFreshPermission = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireFreshPermission: (p: string) => requireFreshPermission(p),
}));

import { PERMISSIONS } from '@/lib/auth/permissions';

import { SchedulingValidationError } from '../errors';
import {
  assertCanCompleteClinically,
  assertClinicalRecordReady,
  canCompleteClinically,
  type ClinicalActor,
} from './clinical-completion';

const DOCTOR = 'doctor-1';
const OTHER = 'doctor-2';

function actor(over: Partial<ClinicalActor> = {}): ClinicalActor {
  return {
    userId: DOCTOR,
    isSuperAdmin: false,
    aal: 'aal1',
    permissions: [PERMISSIONS.CREATE_PRONTUARIO, PERMISSIONS.EDIT_AGENDA],
    ...over,
  };
}

/** Stub mínimo do `tx`: só `execute` é usado pela precondição. */
function txWith(rows: Array<{ status: string }>) {
  return { execute: vi.fn().mockResolvedValue(rows) } as never;
}

beforeEach(() => {
  requireFreshPermission.mockReset();
  requireFreshPermission.mockResolvedValue(undefined);
});

describe('canCompleteClinically (AUTHZ-008) — QUEM conclui', () => {
  it('o atendente do achado é negado: tem edit:agenda, não tem capacidade clínica', () => {
    const attendant = actor({
      userId: 'attendant-1',
      permissions: [PERMISSIONS.EDIT_AGENDA, PERMISSIONS.VIEW_CONSULTORIO],
    });
    expect(canCompleteClinically(attendant, DOCTOR)).toBe(false);
  });

  it('o profissional atribuído conclui', () => {
    expect(canCompleteClinically(actor(), DOCTOR)).toBe(true);
  });

  it('médico com capacidade clínica NÃO conclui atendimento de outro sem delegação', () => {
    expect(canCompleteClinically(actor(), OTHER)).toBe(false);
  });

  it('gestor/owner conclui por delegação administrativa explícita', () => {
    const gestor = actor({
      userId: 'gestor-1',
      permissions: [PERMISSIONS.CREATE_PRONTUARIO, PERMISSIONS.MANAGE_SETTINGS],
    });
    expect(canCompleteClinically(gestor, DOCTOR)).toBe(true);
  });

  it('delegação NÃO substitui capacidade clínica — gestor sem create:prontuario é negado', () => {
    const gestor = actor({ userId: 'gestor-1', permissions: [PERMISSIONS.MANAGE_SETTINGS] });
    expect(canCompleteClinically(gestor, DOCTOR)).toBe(false);
  });

  it('super_admin só com AAL2 (I-1)', () => {
    expect(canCompleteClinically(actor({ isSuperAdmin: true, aal: 'aal2' }), OTHER)).toBe(true);
    expect(canCompleteClinically(actor({ isSuperAdmin: true, aal: 'aal1' }), OTHER)).toBe(false);
  });
});

describe('assertCanCompleteClinically — revalidação no banco', () => {
  it('exige create:prontuario fresh mesmo para o profissional atribuído', async () => {
    await assertCanCompleteClinically(actor(), DOCTOR);
    expect(requireFreshPermission).toHaveBeenCalledWith(PERMISSIONS.CREATE_PRONTUARIO);
    expect(requireFreshPermission).toHaveBeenCalledTimes(1);
  });

  it('para outro profissional, exige também manage:settings fresh', async () => {
    await assertCanCompleteClinically(actor(), OTHER);
    expect(requireFreshPermission).toHaveBeenNthCalledWith(1, PERMISSIONS.CREATE_PRONTUARIO);
    expect(requireFreshPermission).toHaveBeenNthCalledWith(2, PERMISSIONS.MANAGE_SETTINGS);
  });

  it('propaga a negativa fresh — capacidade revogada não fecha consulta', async () => {
    requireFreshPermission.mockRejectedValue(new Error('PERMISSION_DENIED'));
    await expect(assertCanCompleteClinically(actor(), DOCTOR)).rejects.toThrow('PERMISSION_DENIED');
  });
});

describe('assertClinicalRecordReady (AUTHZ-008) — O QUÊ é concluído', () => {
  it('sem prontuário nenhum: recusa e explica o que fazer', async () => {
    await expect(
      assertClinicalRecordReady(txWith([]), 'clinic-a', 'appt-1'),
    ).rejects.toBeInstanceOf(SchedulingValidationError);
    await expect(assertClinicalRecordReady(txWith([]), 'clinic-a', 'appt-1')).rejects.toThrow(
      /ainda não tem prontuário/u,
    );
  });

  it('rascunho NÃO basta — é exatamente o que o worker atrasado produzia', async () => {
    await expect(
      assertClinicalRecordReady(txWith([{ status: 'rascunho' }]), 'clinic-a', 'appt-1'),
    ).rejects.toThrow(/ainda não foi assinado/u);
  });

  it('prontuário assinado libera a conclusão', async () => {
    await expect(
      assertClinicalRecordReady(txWith([{ status: 'assinado' }]), 'clinic-a', 'appt-1'),
    ).resolves.toBeUndefined();
  });
});
