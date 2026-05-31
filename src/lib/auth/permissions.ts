/**
 * Catálogo canônico de permissions — single source of truth no código TS.
 *
 * Decisão (D25 + plano C3 v6): permissions[] no JWT é `string[]` flat,
 * NUNCA objeto. Mudanças neste catálogo exigem:
 *   1. Adicionar a entry aqui (PERMISSIONS)
 *   2. Adicionar INSERT em seed na migration que estende (não modifica) 0003
 *   3. Atualizar bundles em role_permissions conforme necessário
 *   4. ADR se o domínio for novo
 *
 * NÃO criar permissions "ad-hoc" em código (ABAC acidental, D25).
 * NÃO criar permissions por instância (ownership/escopo é P6 — vive em queries de domínio).
 */
export const PERMISSIONS = {
  VIEW_AGENDA: 'view:agenda',
  EDIT_AGENDA: 'edit:agenda',
  // C6: catálogo de procedimentos (preço/duração) e janelas de disponibilidade.
  // Granulares (decisão founder): seed + bundles em migration 0018.
  MANAGE_PROCEDURES: 'manage:procedures',
  MANAGE_AVAILABILITY: 'manage:availability',
  VIEW_PATIENT: 'view:patient',
  CREATE_PATIENT: 'create:patient',
  EDIT_PATIENT: 'edit:patient',
  DELETE_PATIENT: 'delete:patient',
  // F-07: permissão dedicada para o export LGPD (egresso de PII completo). Antes
  // o export exigia apenas view:patient (least-privilege violado). Seed +
  // bundles (owner, gestor) em migration 0013. Catálogo passa a 21 permissions.
  EXPORT_PATIENT: 'export:patient',
  VIEW_PRONTUARIO: 'view:prontuario',
  CREATE_PRONTUARIO: 'create:prontuario',
  SIGN_PRONTUARIO: 'sign:prontuario',
  VIEW_PRESCRIPTION: 'view:prescription',
  CREATE_PRESCRIPTION: 'create:prescription',
  VIEW_FINANCIAL: 'view:financial',
  MANAGE_FINANCIAL: 'manage:financial',
  VIEW_AUDIT: 'view:audit',
  EXPORT_AUDIT: 'export:audit',
  MANAGE_EMPLOYEES: 'manage:employees',
  MANAGE_PERMISSIONS: 'manage:permissions',
  MANAGE_SETTINGS: 'manage:settings',
  MANAGE_AGENT: 'manage:agent',
  VIEW_CONSULTORIO: 'view:consultorio',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Lista completa em runtime — usada para validação contra seed do banco. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(PERMISSIONS),
);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(value);
}
