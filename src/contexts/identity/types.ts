/**
 * Identity context — public type surface for other contexts.
 *
 * Re-exporta de `@/lib/auth/*` (boundaries permitem context → lib).
 * Mantém o nome `@/contexts/identity` como pública surface — outros contexts
 * (patient, scheduling, etc.) importam de cá em vez de descer para lib/auth.
 */
export type { Permission } from '@/lib/auth/permissions';
export type { Role } from '@/lib/auth/roles';
