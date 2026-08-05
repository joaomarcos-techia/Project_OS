/**
 * Canonical platform roles (frozen em PlanoAção §3.18 + ADR-008 §"Frozen surface").
 *
 * super_admin é role de PLATAFORMA (P7), nunca tenant-scoped. As outras 5 são
 * tenant-scoped (sempre acompanhadas de clinic_id no profile).
 *
 * Source of truth: este arquivo. `@/contexts/identity/types` re-exporta para
 * uso cross-context (boundaries permitem context → lib, mas não lib → context).
 */
import { z } from 'zod';

export type Role = 'gestor' | 'doctor' | 'attendant' | 'financial' | 'owner' | 'super_admin';

export const ROLES: readonly Role[] = Object.freeze([
  'gestor',
  'doctor',
  'attendant',
  'financial',
  'owner',
  'super_admin',
]);

export const TENANT_ROLES: readonly Exclude<Role, 'super_admin'>[] = Object.freeze([
  'gestor',
  'doctor',
  'attendant',
  'financial',
  'owner',
]);

export const RoleSchema = z.enum([
  'gestor',
  'doctor',
  'attendant',
  'financial',
  'owner',
  'super_admin',
]);

export function isRole(value: unknown): value is Role {
  return RoleSchema.safeParse(value).success;
}

export function assertRole(value: unknown): Role {
  return RoleSchema.parse(value);
}
