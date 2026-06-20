/**
 * Persistência das sessões de impersonate (C15) — fonte AUTORITATIVA.
 *
 * Escrita/leitura via `dbAdmin` (service_role / BYPASSRLS): a tabela é
 * global-protected (cross-tenant) e o seam é exatamente o cenário que o
 * `defaultTenantPolicy` recusa. `src/lib/impersonation/session.ts` está na
 * allowlist de dbAdmin do arch:db-check.
 *
 * Server-only.
 */
import 'server-only';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db';
import { impersonationSessions } from '@/lib/db/schema/infra/impersonation';
/* eslint-disable boundaries/element-types -- mesma exceção de tenant-context: join read-only à tabela de clínicas (nome p/ o banner) precisa do schema declarado no context tenancy. */
import { clinics } from '@/contexts/tenancy/schema';
/* eslint-enable boundaries/element-types */

import type { ImpersonationView } from './types';

/** TTL fixo de uma sessão de impersonate (OR-I4): 1 hora. */
export const IMPERSONATION_TTL_SECONDS = 3600;

const toIso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/**
 * Cria uma sessão DENTRO da tx fornecida (a do superAdminAction — atômico com o
 * log impersonate_start). Revoga as ativas anteriores do mesmo super_admin ANTES
 * de inserir (OR-I3: no máximo uma ativa). Retorna o id (= impersonationId).
 *
 * NÃO abre transação própria: o pool dbAdmin é max:1; aninhar transação dentro
 * da tx do superAdminAction causaria deadlock.
 */
export async function createSessionTx(
  tx: Tx,
  args: { superAdminId: string; clinicId: string; ip: string | null; userAgent: string | null },
): Promise<string> {
  await tx
    .update(impersonationSessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(impersonationSessions.superAdminId, args.superAdminId),
        isNull(impersonationSessions.revokedAt),
      ),
    );

  const [row] = await tx
    .insert(impersonationSessions)
    .values({
      superAdminId: args.superAdminId,
      clinicId: args.clinicId,
      expiresAt: sql`now() + (${IMPERSONATION_TTL_SECONDS}::int * interval '1 second')`,
      ipAddress: args.ip,
      userAgent: args.userAgent,
    })
    .returning({ id: impersonationSessions.id });

  return row!.id;
}

/**
 * Sessão ativa (não revogada, não expirada) deste id PERTENCENTE a este
 * super_admin. O bind ao super_admin impede que um cookie vazado sirva a outro.
 */
export async function findActiveSession(
  impersonationId: string,
  superAdminId: string,
): Promise<{ id: string; clinicId: string; startedAt: string } | null> {
  const [row] = await dbAdmin
    .select({
      id: impersonationSessions.id,
      clinicId: impersonationSessions.clinicId,
      startedAt: impersonationSessions.startedAt,
    })
    .from(impersonationSessions)
    .where(
      and(
        eq(impersonationSessions.id, impersonationId),
        eq(impersonationSessions.superAdminId, superAdminId),
        isNull(impersonationSessions.revokedAt),
        gt(impersonationSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { id: row.id, clinicId: row.clinicId, startedAt: toIso(row.startedAt) };
}

/** Projeção para o banner (display-only): id válido + nome da clínica. */
export async function findActiveSessionView(
  impersonationId: string,
): Promise<ImpersonationView | null> {
  const [row] = await dbAdmin
    .select({
      id: impersonationSessions.id,
      clinicId: impersonationSessions.clinicId,
      startedAt: impersonationSessions.startedAt,
      expiresAt: impersonationSessions.expiresAt,
      clinicNome: clinics.nome,
    })
    .from(impersonationSessions)
    .innerJoin(clinics, eq(clinics.id, impersonationSessions.clinicId))
    .where(
      and(
        eq(impersonationSessions.id, impersonationId),
        isNull(impersonationSessions.revokedAt),
        gt(impersonationSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    impersonationId: row.id,
    clinicId: row.clinicId,
    clinicNome: row.clinicNome,
    startedAt: toIso(row.startedAt),
    expiresAt: toIso(row.expiresAt),
  };
}

/** Kill switch / encerramento explícito. Idempotente. */
export async function revokeSession(impersonationId: string): Promise<void> {
  await dbAdmin
    .update(impersonationSessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(impersonationSessions.id, impersonationId),
        isNull(impersonationSessions.revokedAt),
      ),
    );
}
