/**
 * Platform Announcements reader (server-only) — avisos globais.
 *
 * `getActiveAnnouncement` é lido pelo SHELL tenant a cada render → cache em
 * memória por instância (TTL 30s) + FAIL-SAFE (erro → null, nunca derruba a
 * tela). `listForAdmin` é para o painel (sem cache, estado fresco).
 *
 * Tabela global-protected (sem dado tenant); leitura via dbAdmin/BYPASSRLS.
 * Escrita vive na action (superAdminAction), nunca aqui.
 */
import 'server-only';

import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { platformAnnouncements } from '@/lib/db/schema/infra/platform-announcements';

const CACHE_TTL_MS = 30_000;

export interface ActiveAnnouncement {
  id: string;
  title: string | null;
  message: string;
  level: string;
}

let cache: { value: ActiveAnnouncement | null; exp: number } | null = null;

/** Aviso ativo e vigente (mais recente). Cacheado 30s; erro → null (fail-safe). */
export async function getActiveAnnouncement(): Promise<ActiveAnnouncement | null> {
  const now = Date.now();
  if (cache && cache.exp > now) return cache.value;
  let value: ActiveAnnouncement | null = null;
  try {
    const [row] = await dbAdmin
      .select({
        id: platformAnnouncements.id,
        title: platformAnnouncements.title,
        message: platformAnnouncements.message,
        level: platformAnnouncements.level,
      })
      .from(platformAnnouncements)
      .where(
        and(
          eq(platformAnnouncements.active, true),
          or(isNull(platformAnnouncements.startsAt), lte(platformAnnouncements.startsAt, sql`now()`)),
          or(isNull(platformAnnouncements.endsAt), gt(platformAnnouncements.endsAt, sql`now()`)),
        ),
      )
      .orderBy(desc(platformAnnouncements.createdAt))
      .limit(1);
    value = row ?? null;
  } catch {
    value = null;
  }
  cache = { value, exp: now + CACHE_TTL_MS };
  return value;
}

export interface AdminAnnouncement {
  id: string;
  title: string | null;
  message: string;
  level: string;
  createdAt: string;
  endsAt: string | null;
}

/** Avisos ativos para o painel (Broadcast). Sem cache. */
export async function listAnnouncementsForAdmin(): Promise<AdminAnnouncement[]> {
  const rows = await dbAdmin
    .select({
      id: platformAnnouncements.id,
      title: platformAnnouncements.title,
      message: platformAnnouncements.message,
      level: platformAnnouncements.level,
      createdAt: platformAnnouncements.createdAt,
      endsAt: platformAnnouncements.endsAt,
    })
    .from(platformAnnouncements)
    .where(eq(platformAnnouncements.active, true))
    .orderBy(desc(platformAnnouncements.createdAt))
    .limit(20);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    message: r.message,
    level: r.level,
    createdAt: r.createdAt.toISOString(),
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
  }));
}
