/**
 * platform_announcements — avisos GLOBAIS exibidos no shell do app tenant.
 *
 * Categoria (ADR-007 §10): global protected. Sem clinic_id (o aviso vale para
 * todas as clínicas). Operacional da plataforma — NÃO é marketing, não passa
 * por suppression list (banner in-app, não WhatsApp).
 *
 * Contratos:
 *   - RLS ENABLE+FORCE; SELECT liberado a `authenticated` (o shell tenant lê o
 *     aviso vigente). Escrita SOMENTE via dbAdmin/service_role (sem policy de
 *     write) — publicação exclusivamente via superAdminAction (auditada).
 *   - Vigência: `active` + janela [starts_at, ends_at] (expira sozinho).
 *   - `message` é texto puro (sem HTML — escapado/validado na action).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidPk } from '@/lib/db/types';

export const platformAnnouncements = pgTable(
  'platform_announcements',
  {
    id: uuidPk(),
    title: text('title'),
    message: text('message').notNull(),
    level: text('level').notNull().default('info'),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    activeIdx: index('platform_announcements_active_idx')
      .on(t.createdAt)
      .where(sql`${t.active}`),
  }),
);

export type PlatformAnnouncementRow = typeof platformAnnouncements.$inferSelect;
export type PlatformAnnouncementInsert = typeof platformAnnouncements.$inferInsert;
