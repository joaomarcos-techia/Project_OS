import { describe, expect, it } from 'vitest';

import { RoleAssignmentError } from '../errors';
import { assertCanAssignRole } from './role-matrix';

describe('assertCanAssignRole (matriz de convite)', () => {
  it('owner pode convidar doctor/attendant/financial/gestor', () => {
    for (const t of ['doctor', 'attendant', 'financial', 'gestor'] as const) {
      expect(() => assertCanAssignRole('owner', t)).not.toThrow();
    }
  });

  it('gestor pode convidar doctor/attendant/financial (não gestor, não owner)', () => {
    for (const t of ['doctor', 'attendant', 'financial'] as const) {
      expect(() => assertCanAssignRole('gestor', t)).not.toThrow();
    }
    expect(() => assertCanAssignRole('gestor', 'gestor')).toThrow(RoleAssignmentError);
    expect(() => assertCanAssignRole('gestor', 'owner')).toThrow(RoleAssignmentError);
  });

  it('ninguém cria owner nem super_admin', () => {
    for (const inv of ['owner', 'gestor', 'doctor', 'attendant', 'financial'] as const) {
      expect(() => assertCanAssignRole(inv, 'owner')).toThrow(RoleAssignmentError);
      expect(() => assertCanAssignRole(inv, 'super_admin')).toThrow(RoleAssignmentError);
    }
  });

  it('doctor/attendant/financial não convidam ninguém', () => {
    for (const inv of ['doctor', 'attendant', 'financial'] as const) {
      for (const t of ['doctor', 'attendant', 'financial', 'gestor'] as const) {
        expect(() => assertCanAssignRole(inv, t)).toThrow(RoleAssignmentError);
      }
    }
  });
});
