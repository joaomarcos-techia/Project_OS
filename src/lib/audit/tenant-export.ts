/**
 * RBAC-001 — export de auditoria em nível de TENANT (`export:audit`).
 *
 * O code existia no catálogo, aparecia no diálogo de permissões e completava
 * grant/deny/default, mas nenhuma página ou action o consumia: o owner podia
 * delegar e revogar uma capacidade sem efeito observável. O único export de
 * auditoria existente é de PLATAFORMA (super-admin, PDF com SHA256 em
 * `admin/clinicas/[id]/audit/export`) e não pode ser confundido com este.
 *
 * Separação explícita:
 *   - PLATFORM ADMIN EXPORT: super-admin, cross-tenant, artefato assinado, vive
 *     em `(admin)` e grava `super_admin_actions`.
 *   - TENANT AUDIT EXPORT (aqui): a clínica exporta a PRÓPRIA trilha, sob RLS,
 *     com o `clinicId` do request. Nunca recebe `clinic_id` do cliente.
 *
 * LGPD: `before`/`after` NÃO entram no CSV. Eles carregam o estado de registros
 * de paciente (nome, contato, dados clínicos); a trilha responde "quem fez o
 * quê e quando", não "qual era o dado". Exportar o conteúdo transformaria uma
 * permissão de auditoria numa via paralela de extração de prontuário.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, eq, gte, lte } from 'drizzle-orm';

import { auditEvents } from '@/lib/db/schema/infra/audit';
import { withTenant } from '@/lib/db/tenant';

/**
 * Teto por export. Mesmo racional do B6 no export de plataforma: um artefato de
 * auditoria incompleto que se apresenta como completo é pior que a ausência
 * dele — então o corte é DECLARADO, não silencioso.
 */
export const TENANT_AUDIT_EXPORT_MAX_ROWS = 5000;

/** Janela máxima por export, para o teto acima ser atingível na prática. */
export const TENANT_AUDIT_EXPORT_MAX_DAYS = 92;

export interface TenantAuditExport {
  csv: string;
  rowCount: number;
  /** `true` quando o período rende mais que o teto: o CSV está incompleto. */
  truncated: boolean;
  from: string;
  to: string;
}

export class AuditExportRangeError extends Error {
  readonly code = 'audit_export_range';
  readonly httpStatus = 422;
  constructor(message: string) {
    super(message);
    this.name = 'AuditExportRangeError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Valida o período pedido. Puro — testável sem banco. */
export function assertExportRange(from: Date, to: Date, now: Date = new Date()): void {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AuditExportRangeError('Informe um período válido.');
  }
  if (to.getTime() < from.getTime()) {
    throw new AuditExportRangeError('A data final deve ser posterior à inicial.');
  }
  if (from.getTime() > now.getTime()) {
    throw new AuditExportRangeError('O período não pode começar no futuro.');
  }
  if (to.getTime() - from.getTime() > TENANT_AUDIT_EXPORT_MAX_DAYS * DAY_MS) {
    throw new AuditExportRangeError(
      `O período máximo por export é de ${TENANT_AUDIT_EXPORT_MAX_DAYS} dias. Exporte em partes.`,
    );
  }
}

/** Escapa um campo de CSV (RFC 4180). */
function csvField(value: string | null): string {
  if (value === null) return '';
  // O `'` na frente de `=+-@` neutraliza fórmula: um `action` que começasse com
  // `=` viraria execução ao abrir o CSV numa planilha.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

const HEADER = ['data_hora', 'acao', 'recurso_tipo', 'recurso_id', 'usuario_id', 'ip'] as const;

/**
 * Exporta a trilha da PRÓPRIA clínica no período. `clinicId` vem sempre do
 * request (`requireClinicId`), nunca de input — e a leitura roda em
 * `withTenant`, então a RLS isola mesmo se alguém passar outro id por engano.
 */
export async function exportTenantAudit(
  clinicId: string,
  range: { from: Date; to: Date },
): Promise<TenantAuditExport> {
  assertExportRange(range.from, range.to);

  const rows = await withTenant(clinicId, (tx) =>
    tx
      .select({
        createdAt: auditEvents.createdAt,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        userId: auditEvents.userId,
        ipAddress: auditEvents.ipAddress,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.clinicId, clinicId),
          gte(auditEvents.createdAt, range.from),
          lte(auditEvents.createdAt, range.to),
        ),
      )
      .orderBy(asc(auditEvents.createdAt))
      // +1 para DETECTAR o estouro em vez de cortar em silêncio.
      .limit(TENANT_AUDIT_EXPORT_MAX_ROWS + 1),
  );

  const truncated = rows.length > TENANT_AUDIT_EXPORT_MAX_ROWS;
  const included = truncated ? rows.slice(0, TENANT_AUDIT_EXPORT_MAX_ROWS) : rows;

  const lines = [HEADER.join(',')];
  for (const row of included) {
    const createdAt =
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
    lines.push(
      [
        csvField(createdAt),
        csvField(row.action),
        csvField(row.resourceType),
        csvField(row.resourceId),
        csvField(row.userId),
        csvField(row.ipAddress),
      ].join(','),
    );
  }

  return {
    csv: lines.join('\n'),
    rowCount: included.length,
    truncated,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  };
}
