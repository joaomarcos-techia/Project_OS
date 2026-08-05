/**
 * system_metrics_daily — agregados diários por clínica (C16, FASE 7).
 *
 * Modelo EAV enxuto `(clinic_id, date, metric_name) → value`: cada métrica vira
 * uma linha, então adicionar uma métrica nova NÃO exige migration de coluna.
 * Populada pelo cron /api/cron/metrics-rollup (UPSERT idempotente da janela
 * recente), lida pelo painel/relatórios. Base histórica para aferir os SLOs de
 * docs/c16/slo.md.
 *
 * Categoria (ADR-007 §10): tenant-scoped. RLS `defaultTenantPolicy(v1)` aplicada
 * na migration (mesma do cash_flow_daily): a clínica lê o seu; super_admin lê
 * tudo; a escrita real vem do cron via dbAdmin (BYPASSRLS). FK clinic_id e os
 * GRANTs também são adicionados na migration (padrão das infra tables).
 *
 * `value` é numeric(20,4): cobre contagens inteiras (patients_created) e valores
 * fracionários (ai_cost_usd, revenue_received) sem perda.
 */
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const systemMetricsDaily = pgTable(
  'system_metrics_daily',
  {
    clinicId: uuid('clinic_id').notNull(),
    date: date('date').notNull(),
    metricName: text('metric_name').notNull(),
    value: numeric('value', { precision: 20, scale: 4 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clinicId, t.date, t.metricName] }),
    // Consulta cross-tenant por métrica (dashboards super_admin / SLO).
    metricDateIdx: index('system_metrics_daily_metric_date_idx').on(t.metricName, t.date),
  }),
);

export type SystemMetricsDailyRow = typeof systemMetricsDaily.$inferSelect;
export type SystemMetricsDailyInsert = typeof systemMetricsDaily.$inferInsert;
