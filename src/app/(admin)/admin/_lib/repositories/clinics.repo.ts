/**
 * ClinicRepository (C15) — lista e detalhe de clínicas (cross-tenant via dbAdmin).
 * Único ponto que toca dbAdmin para esta área (review #5/#13).
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import { aiConversations, aiMessages } from '@/contexts/ai-agent/schema';
import {
  billingCustomers,
  invoices,
  plans,
  prices,
  subscriptions,
} from '@/contexts/billing/schema';
import { profiles } from '@/contexts/identity/schema';
import { clinicWhatsappNumbers } from '@/contexts/messaging/schema';
import { clinics } from '@/contexts/tenancy/schema';
import { decryptForTenant } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema/infra/audit';

import type {
  AuditEntryDTO,
  ClinicDetailDTO,
  ClinicListItemDTO,
  ClinicListResultDTO,
} from '../dto';
import { toCents } from '../format';

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();
const int = (raw: unknown): number => {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
};

export interface ClinicListQuery {
  search?: string | undefined;
  status?: string | undefined;
  plan?: string | undefined;
  billing?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export class ClinicRepository {
  async list(q: ClinicListQuery): Promise<ClinicListResultDTO> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(q.pageSize ?? 20, 1), 100);
    const offset = (page - 1) * pageSize;

    const conds: SQL[] = [isNull(clinics.deletedAt)];
    if (q.search) {
      const term = `%${q.search.trim().slice(0, 64)}%`;
      conds.push(or(ilike(clinics.nome, term), ilike(clinics.slug, term)) as SQL);
    }
    if (q.status) conds.push(eq(clinics.status, q.status as never));
    if (q.plan) conds.push(eq(plans.code, q.plan));
    if (q.billing) conds.push(eq(subscriptions.billingStatus, q.billing as never));
    const where = and(...conds);

    const rows = await dbAdmin
      .select({
        id: clinics.id,
        nome: clinics.nome,
        slug: clinics.slug,
        status: clinics.status,
        planCode: plans.code,
        billingStatus: subscriptions.billingStatus,
      })
      .from(clinics)
      .leftJoin(subscriptions, eq(subscriptions.clinicId, clinics.id))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(where)
      .orderBy(desc(clinics.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [countRow] = await dbAdmin
      .select({ n: sql<number>`(COUNT(*))::int` })
      .from(clinics)
      .leftJoin(subscriptions, eq(subscriptions.clinicId, clinics.id))
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(where);

    // Última atividade: UMA query agregada para os ids da página (janela 90d →
    // partition pruning + índice clinic_id,created_at). Evita subquery correlacionada
    // por linha sobre a audit_events particionada (causa de "loading infinito").
    const ids = rows.map((r) => r.id);
    const lastActivity = new Map<string, string | null>();
    if (ids.length > 0) {
      const act = await dbAdmin
        .select({
          clinicId: auditEvents.clinicId,
          last: sql<string | null>`MAX(${auditEvents.createdAt})`,
        })
        .from(auditEvents)
        .where(
          and(
            inArray(auditEvents.clinicId, ids),
            sql`${auditEvents.createdAt} >= now() - interval '90 days'`,
          ),
        )
        .groupBy(auditEvents.clinicId);
      for (const a of act) lastActivity.set(a.clinicId, a.last);
    }

    const items: ClinicListItemDTO[] = rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      slug: r.slug,
      status: r.status,
      planCode: r.planCode ?? null,
      billingStatus: r.billingStatus ?? null,
      lastActivityAt: iso(lastActivity.get(r.id) ?? null),
    }));

    return { items, total: int(countRow?.n), page, pageSize };
  }

  /** Clínicas em risco (suspensas / aguardando pagamento) — painel da visão geral. */
  async listAtRisk(
    limit = 4,
  ): Promise<{ id: string; nome: string; slug: string; status: string }[]> {
    return dbAdmin
      .select({ id: clinics.id, nome: clinics.nome, slug: clinics.slug, status: clinics.status })
      .from(clinics)
      .where(
        and(
          isNull(clinics.deletedAt),
          sql`${clinics.status} IN ('suspended_readonly','suspended','pending_payment')`,
        ),
      )
      .orderBy(desc(clinics.createdAt))
      .limit(limit);
  }

  /** Opções (id+nome) para selects de filtro (conversas/audit). Bounded. */
  async listOptions(): Promise<{ id: string; nome: string }[]> {
    return dbAdmin
      .select({ id: clinics.id, nome: clinics.nome })
      .from(clinics)
      .where(isNull(clinics.deletedAt))
      .orderBy(asc(clinics.nome))
      .limit(1000);
  }

  async getDetail(clinicId: string): Promise<ClinicDetailDTO | null> {
    const [c] = await dbAdmin
      .select({
        id: clinics.id,
        nome: clinics.nome,
        slug: clinics.slug,
        status: clinics.status,
        cnpjEncrypted: clinics.cnpjEncrypted,
        timezone: clinics.timezone,
        createdAt: clinics.createdAt,
      })
      .from(clinics)
      .where(and(eq(clinics.id, clinicId), isNull(clinics.deletedAt)))
      .limit(1);
    if (!c) return null;

    // A8: decifra o CNPJ para o painel admin (salt = id da própria clínica).
    const cnpj = c.cnpjEncrypted ? await decryptForTenant(c.id, c.cnpjEncrypted) : null;

    // Plano + preço vigente da assinatura.
    const [sub] = await dbAdmin
      .select({
        billingStatus: subscriptions.billingStatus,
        dunningStage: subscriptions.dunningStage,
        planCode: plans.code,
        planName: plans.name,
        priceAmount: prices.amount,
        cycle: prices.billingCycle,
      })
      .from(subscriptions)
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(prices, eq(prices.id, subscriptions.priceId))
      .where(eq(subscriptions.clinicId, clinicId))
      .limit(1);

    const [inv] = await dbAdmin
      .select({
        open: sql<number>`(COUNT(*) FILTER (WHERE ${invoices.status} = 'open'))::int`,
        overdue: sql<number>`(COUNT(*) FILTER (WHERE ${invoices.status} = 'overdue'))::int`,
        lastPaidAt: sql<
          string | null
        >`MAX(${invoices.paidAt}) FILTER (WHERE ${invoices.status} = 'paid')`,
      })
      .from(invoices)
      .where(eq(invoices.clinicId, clinicId));

    const users = await dbAdmin
      .select({
        id: profiles.id,
        nome: profiles.nome,
        role: profiles.role,
        ativo: profiles.ativo,
      })
      .from(profiles)
      .where(and(eq(profiles.clinicId, clinicId), isNull(profiles.deletedAt)))
      .orderBy(desc(profiles.createdAt))
      .limit(50);

    // Uso de IA — janela de 30 dias (bounded; ai_messages é particionada por mês).
    const [conv] = await dbAdmin
      .select({ n: sql<number>`(COUNT(*))::int` })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.clinicId, clinicId),
          sql`${aiConversations.startedAt} >= now() - interval '30 days'`,
        ),
      );
    const [msg] = await dbAdmin
      .select({
        n: sql<number>`(COUNT(*))::int`,
        tokens: sql<number>`(COALESCE(SUM(COALESCE(${aiMessages.tokensInput},0)+COALESCE(${aiMessages.tokensOutput},0)),0))::int`,
        cost: sql<string>`COALESCE(SUM(${aiMessages.costUsd}),0)`,
      })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.clinicId, clinicId),
          sql`${aiMessages.createdAt} >= now() - interval '30 days'`,
        ),
      );

    // Integrações.
    const [wa] = await dbAdmin
      .select({ verifiedAt: clinicWhatsappNumbers.verifiedAt })
      .from(clinicWhatsappNumbers)
      .where(
        and(eq(clinicWhatsappNumbers.clinicId, clinicId), eq(clinicWhatsappNumbers.active, true)),
      )
      .limit(1);
    const [bc] = await dbAdmin
      .select({ asaasCustomerId: billingCustomers.asaasCustomerId })
      .from(billingCustomers)
      .where(eq(billingCustomers.clinicId, clinicId))
      .limit(1);

    const recent = await dbAdmin
      .select({
        id: auditEvents.id,
        createdAt: auditEvents.createdAt,
        userId: auditEvents.userId,
        action: auditEvents.action,
        clinicId: auditEvents.clinicId,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        ip: sql<string | null>`${auditEvents.ipAddress}::text`,
      })
      .from(auditEvents)
      // Janela de 90d (tier "hot" — migration 0009): poda as partições antigas e
      // evita Merge Append sobre TODAS conforme audit_events cresce. Trade-off:
      // clínica sem auditoria nos últimos 90d aparece sem "últimas auditorias".
      .where(
        and(
          eq(auditEvents.clinicId, clinicId),
          sql`${auditEvents.createdAt} >= now() - interval '90 days'`,
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(8);

    const recentAudit: AuditEntryDTO[] = recent.map((r) => ({
      id: r.id,
      timestamp: iso(r.createdAt)!,
      userId: r.userId ?? null,
      action: r.action,
      clinicId: r.clinicId,
      resourceType: r.resourceType,
      resourceId: r.resourceId ?? null,
      ip: r.ip ?? null,
      result: 'ok',
    }));

    return {
      general: {
        id: c.id,
        nome: c.nome,
        slug: c.slug,
        status: c.status,
        cnpj,
        timezone: c.timezone,
        createdAt: iso(c.createdAt)!,
      },
      plan: sub?.planCode
        ? {
            code: sub.planCode,
            name: sub.planName ?? sub.planCode,
            priceCents: toCents(sub.priceAmount ?? '0'),
            cycle: sub.cycle ?? 'monthly',
          }
        : null,
      billing: {
        openInvoices: int(inv?.open),
        overdue: int(inv?.overdue),
        dunningStage: int(sub?.dunningStage),
        billingStatus: sub?.billingStatus ?? null,
        lastPaidAt: iso(inv?.lastPaidAt ?? null),
      },
      users: users.map((u) => ({ id: u.id, nome: u.nome, role: u.role, ativo: u.ativo })),
      aiUsage: {
        conversations: int(conv?.n),
        messages: int(msg?.n),
        tokens: int(msg?.tokens),
        costUsd: Number(msg?.cost ?? 0),
      },
      integrations: {
        whatsapp: wa ? (wa.verifiedAt ? 'connected' : 'pending') : 'none',
        asaas: bc?.asaasCustomerId ? 'linked' : 'none',
      },
      recentAudit,
    };
  }
}

export const clinicRepository = new ClinicRepository();
