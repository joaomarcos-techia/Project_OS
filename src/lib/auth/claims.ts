/**
 * JWT Claims — shape canônica injetada pelo Custom Access Token Hook (0003 + 0006).
 *
 * Frozen em ADR-008 + ADR-009:
 *   - clinic_id: string UUID OU null (apenas super_admin).
 *   - app_role: Role enum. NOTA: nome é `app_role`, NÃO `role` — PostgREST
 *     reserva o claim `role` para definir o Postgres role da request
 *     (authenticated/anon/service_role). Sobrescrever `role` quebra todo
 *     SELECT via supabase-js client com "role X does not exist". Migration
 *     0006 corrigiu isso (renomeou Hook output).
 *   - permissions: string[] FLAT (D25 — nunca objeto).
 *   - claims_version: integer monotonic (D5/ADR-009 — drift detection).
 *   - super_admin: boolean shortcut (Hook injeta true quando app_role='super_admin').
 *   - aal: 'aal1' | 'aal2' (Supabase Auth — nível AAL2 quando MFA passou).
 *
 * O Hook RETORNA event sem essas claims quando o profile é inativo/deletado
 * ou inconsistente (D36 deny-by-default). Frontend trata claims ausentes como
 * "sem autorização" → middleware redireciona /login.
 */
import { z } from 'zod';

import { ALL_PERMISSIONS, type Permission } from './permissions';
import { RoleSchema, type Role } from './roles';

export type { Permission, Role };

export const ClaimsSchema = z.object({
  clinic_id: z.string().uuid().nullable(),
  app_role: RoleSchema,
  permissions: z.array(z.string()).max(128), // D34 cap defensivo (Hook RAISE acima disso)
  claims_version: z.number().int().nonnegative(),
  super_admin: z.boolean().optional(),
  // Tokens emitted before migration 0055 omit this claim. They are invalidated
  // when the migration bumps claims_version; accepting the legacy shape keeps
  // backward compatibility during the deploy window.
  granular_permissions_enabled: z.boolean().optional(),
  aal: z.enum(['aal1', 'aal2']).optional(),
});

export type JWTClaims = z.infer<typeof ClaimsSchema>;

/**
 * Parse defensivo das claims customizadas. Se NÃO houver claims (token sem
 * Hook-populado), retorna null — chamador trata como "sem autorização".
 *
 * Aceita o payload bruto do JWT (já decoded por @supabase/supabase-js). NUNCA
 * faz signature verification (Supabase já fez ao emitir; nosso código confia
 * no resultado de getUser()).
 */
export function parseClaims(payload: unknown): JWTClaims | null {
  if (!payload || typeof payload !== 'object') return null;
  const parsed = ClaimsSchema.safeParse(payload);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Filtra permissions desconhecidas (paranóia: Hook poderia injetar permission
 * removida do catálogo TS). Retorna apenas Permissions reconhecidas.
 */
export function sanitizePermissions(input: readonly string[]): Permission[] {
  const known = new Set<string>(ALL_PERMISSIONS);
  return input.filter((p): p is Permission => known.has(p));
}
