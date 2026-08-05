import 'server-only';

import { and, asc, desc, eq, gte, ilike, isNull, lt, sql } from 'drizzle-orm';

import { feedbackHistory, feedbackSuggestions } from '@/contexts/feedback/schema';
import { plans, subscriptions } from '@/contexts/billing/schema';
import { profiles } from '@/contexts/identity/schema';
import { clinics } from '@/contexts/tenancy/schema';
import { dbAdmin } from '@/lib/db';

const PAGE_SIZE = 30;
const FEEDBACK_STATUSES = [
  'received',
  'under_review',
  'planned',
  'in_development',
  'completed',
  'rejected',
  'archived',
] as const;
const FEEDBACK_CATEGORIES = ['feature', 'improvement', 'bug', 'other'] as const;
const FEEDBACK_ORDERS = ['newest', 'oldest', 'priority'] as const;

export type FeedbackStatusFilter = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackCategoryFilter = (typeof FEEDBACK_CATEGORIES)[number];

export function isFeedbackStatus(value: string | undefined): value is FeedbackStatusFilter {
  return Boolean(value && (FEEDBACK_STATUSES as readonly string[]).includes(value));
}

export function isFeedbackCategory(value: string | undefined): value is FeedbackCategoryFilter {
  return Boolean(value && (FEEDBACK_CATEGORIES as readonly string[]).includes(value));
}

export type FeedbackOrder = (typeof FEEDBACK_ORDERS)[number];

export function isFeedbackOrder(value: string | undefined): value is FeedbackOrder {
  return Boolean(value && (FEEDBACK_ORDERS as readonly string[]).includes(value));
}

export type FeedbackListFilters = {
  status?: FeedbackStatusFilter | undefined;
  category?: FeedbackCategoryFilter | undefined;
  query?: string | undefined;
  clinicQuery?: string | undefined;
  userQuery?: string | undefined;
  createdFrom?: Date | undefined;
  createdBefore?: Date | undefined;
  order?: FeedbackOrder | undefined;
  page?: number | undefined;
};

function filtersWhere(filters: FeedbackListFilters) {
  const clauses = [isNull(feedbackSuggestions.deletedAt)];
  if (filters.status) clauses.push(eq(feedbackSuggestions.status, filters.status));
  if (filters.category) clauses.push(eq(feedbackSuggestions.category, filters.category));
  if (filters.query) {
    const pattern = `%${filters.query.trim().slice(0, 120)}%`;
    if (pattern !== '%%') {
      clauses.push(
        sql`(${feedbackSuggestions.title} ILIKE ${pattern} OR ${feedbackSuggestions.description} ILIKE ${pattern})`,
      );
    }
  }
  if (filters.clinicQuery?.trim())
    clauses.push(ilike(clinics.nome, `%${filters.clinicQuery.trim().slice(0, 120)}%`));
  if (filters.userQuery?.trim())
    clauses.push(ilike(profiles.nome, `%${filters.userQuery.trim().slice(0, 120)}%`));
  if (filters.createdFrom) clauses.push(gte(feedbackSuggestions.createdAt, filters.createdFrom));
  if (filters.createdBefore) clauses.push(lt(feedbackSuggestions.createdAt, filters.createdBefore));
  return and(...clauses);
}

function feedbackOrder(order: FeedbackOrder | undefined) {
  if (order === 'oldest') return asc(feedbackSuggestions.createdAt);
  if (order === 'priority') return desc(feedbackSuggestions.priority);
  return desc(feedbackSuggestions.createdAt);
}

export type FeedbackListItem = {
  id: string;
  clinicId: string;
  clinicName: string;
  userName: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listFeedback(filters: FeedbackListFilters): Promise<{
  rows: FeedbackListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const where = filtersWhere(filters);
  const page = Math.max(1, filters.page ?? 1);
  const [count] = await dbAdmin
    .select({ total: sql<number>`count(*)::int` })
    .from(feedbackSuggestions)
    .innerJoin(clinics, eq(clinics.id, feedbackSuggestions.clinicId))
    .leftJoin(profiles, eq(profiles.id, feedbackSuggestions.userId))
    .where(where);
  const total = count?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = await dbAdmin
    .select({
      id: feedbackSuggestions.id,
      clinicId: feedbackSuggestions.clinicId,
      clinicName: clinics.nome,
      userName: profiles.nome,
      title: feedbackSuggestions.title,
      description: feedbackSuggestions.description,
      category: feedbackSuggestions.category,
      priority: feedbackSuggestions.priority,
      status: feedbackSuggestions.status,
      createdAt: feedbackSuggestions.createdAt,
      updatedAt: feedbackSuggestions.updatedAt,
    })
    .from(feedbackSuggestions)
    .innerJoin(clinics, eq(clinics.id, feedbackSuggestions.clinicId))
    .leftJoin(profiles, eq(profiles.id, feedbackSuggestions.userId))
    .where(where)
    .orderBy(feedbackOrder(filters.order), desc(feedbackSuggestions.createdAt))
    .limit(PAGE_SIZE)
    .offset((safePage - 1) * PAGE_SIZE);
  return { rows, total, page: safePage, pageCount };
}

export type FeedbackExportRow = FeedbackListItem & {
  browser: string | null;
  platform: string | null;
};

/** Exportação administrativa limitada: evita gerar arquivos sem limite por engano. */
export async function exportFeedback(
  filters: Omit<FeedbackListFilters, 'page'>,
): Promise<FeedbackExportRow[]> {
  const where = filtersWhere(filters);
  return dbAdmin
    .select({
      id: feedbackSuggestions.id,
      clinicId: feedbackSuggestions.clinicId,
      clinicName: clinics.nome,
      userName: profiles.nome,
      title: feedbackSuggestions.title,
      description: feedbackSuggestions.description,
      category: feedbackSuggestions.category,
      priority: feedbackSuggestions.priority,
      status: feedbackSuggestions.status,
      browser: feedbackSuggestions.browser,
      platform: feedbackSuggestions.platform,
      createdAt: feedbackSuggestions.createdAt,
      updatedAt: feedbackSuggestions.updatedAt,
    })
    .from(feedbackSuggestions)
    .innerJoin(clinics, eq(clinics.id, feedbackSuggestions.clinicId))
    .leftJoin(profiles, eq(profiles.id, feedbackSuggestions.userId))
    .where(where)
    .orderBy(feedbackOrder(filters.order), desc(feedbackSuggestions.createdAt))
    .limit(5_000);
}

export type FeedbackDetail = FeedbackListItem & {
  planName: string | null;
  userId: string | null;
  browser: string | null;
  platform: string | null;
  appVersion: string | null;
  adminNotes: string | null;
  closedAt: Date | null;
  history: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    changedByName: string | null;
    createdAt: Date;
  }>;
};

export async function getFeedbackDetail(id: string): Promise<FeedbackDetail | null> {
  const [feedback] = await dbAdmin
    .select({
      id: feedbackSuggestions.id,
      clinicId: feedbackSuggestions.clinicId,
      clinicName: clinics.nome,
      planName: plans.name,
      userId: feedbackSuggestions.userId,
      userName: profiles.nome,
      title: feedbackSuggestions.title,
      description: feedbackSuggestions.description,
      category: feedbackSuggestions.category,
      priority: feedbackSuggestions.priority,
      status: feedbackSuggestions.status,
      browser: feedbackSuggestions.browser,
      platform: feedbackSuggestions.platform,
      appVersion: feedbackSuggestions.appVersion,
      adminNotes: feedbackSuggestions.adminNotes,
      closedAt: feedbackSuggestions.closedAt,
      createdAt: feedbackSuggestions.createdAt,
      updatedAt: feedbackSuggestions.updatedAt,
    })
    .from(feedbackSuggestions)
    .innerJoin(clinics, eq(clinics.id, feedbackSuggestions.clinicId))
    .leftJoin(profiles, eq(profiles.id, feedbackSuggestions.userId))
    .leftJoin(subscriptions, eq(subscriptions.clinicId, feedbackSuggestions.clinicId))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(feedbackSuggestions.id, id), isNull(feedbackSuggestions.deletedAt)))
    .limit(1);
  if (!feedback) return null;
  const history = await dbAdmin
    .select({
      id: feedbackHistory.id,
      action: feedbackHistory.action,
      fromStatus: feedbackHistory.fromStatus,
      toStatus: feedbackHistory.toStatus,
      note: feedbackHistory.note,
      changedByName: profiles.nome,
      createdAt: feedbackHistory.createdAt,
    })
    .from(feedbackHistory)
    .leftJoin(profiles, eq(profiles.id, feedbackHistory.changedBy))
    .where(eq(feedbackHistory.feedbackId, id))
    .orderBy(desc(feedbackHistory.createdAt));
  return { ...feedback, history };
}

export async function getFeedbackMetrics(): Promise<{
  total: number;
  completed: number;
  avgHoursToClose: number | null;
  byStatus: Array<{ label: string; count: number }>;
  byCategory: Array<{ label: string; count: number }>;
  topClinics: Array<{ label: string; count: number }>;
  byMonth: Array<{ label: string; count: number }>;
}> {
  const [total] = await dbAdmin.execute<{
    total: number;
    completed: number;
    avg_hours: number | null;
  }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'completed')::int AS completed,
           avg(extract(epoch FROM (closed_at - created_at)) / 3600) FILTER (WHERE closed_at IS NOT NULL) AS avg_hours
      FROM public.feedback_suggestions
     WHERE deleted_at IS NULL
  `);
  const byStatus = await dbAdmin.execute<{ label: string; count: number }>(sql`
    SELECT status::text AS label, count(*)::int AS count
      FROM public.feedback_suggestions
     WHERE deleted_at IS NULL
     GROUP BY status
     ORDER BY count DESC, label ASC
  `);
  const byCategory = await dbAdmin.execute<{ label: string; count: number }>(sql`
    SELECT category::text AS label, count(*)::int AS count
      FROM public.feedback_suggestions
     WHERE deleted_at IS NULL
     GROUP BY category
     ORDER BY count DESC, label ASC
  `);
  const topClinics = await dbAdmin.execute<{ label: string; count: number }>(sql`
    SELECT c.nome AS label, count(*)::int AS count
      FROM public.feedback_suggestions f
      JOIN public.clinics c ON c.id = f.clinic_id
     WHERE f.deleted_at IS NULL
     GROUP BY c.id, c.nome
     ORDER BY count DESC, c.nome ASC
     LIMIT 5
  `);
  const byMonth = await dbAdmin.execute<{ label: string; count: number }>(sql`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS label, count(*)::int AS count
      FROM public.feedback_suggestions
     WHERE deleted_at IS NULL
       AND created_at >= date_trunc('month', now()) - interval '5 months'
     GROUP BY date_trunc('month', created_at)
     ORDER BY date_trunc('month', created_at)
  `);
  return {
    total: Number(total?.total ?? 0),
    completed: Number(total?.completed ?? 0),
    avgHoursToClose:
      total?.avg_hours === null || total?.avg_hours === undefined ? null : Number(total.avg_hours),
    byStatus: byStatus.map((row) => ({ label: row.label, count: Number(row.count) })),
    byCategory: byCategory.map((row) => ({ label: row.label, count: Number(row.count) })),
    topClinics: topClinics.map((row) => ({ label: row.label, count: Number(row.count) })),
    byMonth: byMonth.map((row) => ({ label: row.label, count: Number(row.count) })),
  };
}
