/**
 * AuditRepository (C15) — busca cross-tenant em audit_events + leitura por
 * intervalo para o export PDF. Único ponto que toca dbAdmin para esta área.
 *
 * Nota sobre `result`: audit_events é append-only e só existe para mutações
 * COMMITADAS ("no audit, no op") — logo o resultado é sempre sucesso. Falhas
 * vivem em outras tabelas (ai_agent_failures, outbox failed). Exibimos 'ok'.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema/infra/audit';

import type { AuditEntryDTO, AuditSearchResultDTO } from '../dto';

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/**
 * Termo p/ busca parcial case-insensitive em `action`. Escapa os curingas de LIKE
 * (`%`, `_`, `\`) para que o input seja tratado como literal (sem surpresa de
 * wildcard) e limita o tamanho. Ex.: "impersonate" casa `impersonate_start`.
 */
function likeContains(term: string): string {
  const escaped = term
    .trim()
    .slice(0, 80)
    .replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

export interface AuditSearchQuery {
  userId?: string | undefined;
  clinicId?: string | undefined;
  action?: string | undefined;
  entity?: string | undefined; // resource_type
  from?: string | undefined; // ISO
  to?: string | undefined; // ISO
  page?: number | undefined;
  pageSize?: number | undefined;
}

/** Teto de linhas no export PDF (mantém o arquivo/hash determinísticos e sãos). */
export const AUDIT_EXPORT_MAX_ROWS = 5000;

function buildConds(q: Omit<AuditSearchQuery, 'page' | 'pageSize'>): SQL[] {
  const conds: SQL[] = [];
  if (q.userId) conds.push(eq(auditEvents.userId, q.userId));
  if (q.clinicId) conds.push(eq(auditEvents.clinicId, q.clinicId));
  if (q.action) conds.push(ilike(auditEvents.action, likeContains(q.action)));
  if (q.entity) conds.push(eq(auditEvents.resourceType, q.entity));
  if (q.from) conds.push(gte(auditEvents.createdAt, sql`${q.from}::timestamptz`));
  if (q.to) conds.push(lte(auditEvents.createdAt, sql`${q.to}::timestamptz`));
  return conds;
}

const selectShape = {
  id: auditEvents.id,
  createdAt: auditEvents.createdAt,
  userId: auditEvents.userId,
  action: auditEvents.action,
  clinicId: auditEvents.clinicId,
  resourceType: auditEvents.resourceType,
  resourceId: auditEvents.resourceId,
  ip: sql<string | null>`${auditEvents.ipAddress}::text`,
} as const;

function toDto(r: {
  id: string;
  createdAt: Date | string;
  userId: string | null;
  action: string;
  clinicId: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
}): AuditEntryDTO {
  return {
    id: r.id,
    timestamp: iso(r.createdAt),
    userId: r.userId ?? null,
    action: r.action,
    clinicId: r.clinicId,
    resourceType: r.resourceType,
    resourceId: r.resourceId ?? null,
    ip: r.ip ?? null,
    result: 'ok',
  };
}

export class AuditRepository {
  async search(q: AuditSearchQuery): Promise<AuditSearchResultDTO> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), 200);
    const offset = (page - 1) * pageSize;
    const conds = buildConds(q);
    const where = conds.length ? and(...conds) : undefined;

    const rows = await dbAdmin
      .select(selectShape)
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [countRow] = await dbAdmin
      .select({ n: sql<number>`(COUNT(*))::int` })
      .from(auditEvents)
      .where(where);

    return {
      items: rows.map(toDto),
      total: Number(countRow?.n) || 0,
      page,
      pageSize,
    };
  }

  /** Leitura por clínica + intervalo para o export PDF (ordem cronológica). */
  async findByClinicRange(clinicId: string, from: string, to: string): Promise<AuditEntryDTO[]> {
    const rows = await dbAdmin
      .select(selectShape)
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.clinicId, clinicId),
          gte(auditEvents.createdAt, sql`${from}::timestamptz`),
          lte(auditEvents.createdAt, sql`${to}::timestamptz`),
        ),
      )
      .orderBy(asc(auditEvents.createdAt))
      .limit(AUDIT_EXPORT_MAX_ROWS);
    return rows.map(toDto);
  }
}

export const auditRepository = new AuditRepository();
