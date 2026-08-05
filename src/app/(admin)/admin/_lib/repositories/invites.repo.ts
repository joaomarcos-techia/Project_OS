/**
 * InvitesRepository (F1) — lista de convites de clínica + catálogo de planos para o
 * modal. Read-only via dbAdmin (clinic_invites é global-protected). Único ponto que
 * toca dbAdmin para esta área.
 *
 * Server-only.
 */
import 'server-only';
import { desc, eq, inArray } from 'drizzle-orm';

import { plans } from '@/contexts/billing/schema';
import { clinicInvites } from '@/contexts/onboarding/schema';
import { clinics } from '@/contexts/tenancy/schema';
import { dbAdmin } from '@/lib/db';

const iso = (v: Date | null): string | null => (v ? v.toISOString() : null);

export interface InviteListItem {
  id: string;
  version: number;
  status: string;
  email: string | null;
  planCode: string | null;
  clinicNome: string | null;
  createdAt: string;
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PlanOption {
  id: string;
  code: string;
  name: string;
}

export class InvitesRepository {
  /** Planos ativos para o select do modal "+ Nova Clínica". */
  async listPlans(): Promise<PlanOption[]> {
    return dbAdmin
      .select({ id: plans.id, code: plans.code, name: plans.name })
      .from(plans)
      .where(eq(plans.ativo, true))
      .orderBy(plans.name);
  }

  /** Convites recentes (lista da aba). Resolve plano sugerido + clínica provisionada. */
  async list(limit = 50): Promise<InviteListItem[]> {
    const rows = await dbAdmin
      .select()
      .from(clinicInvites)
      .orderBy(desc(clinicInvites.createdAt))
      .limit(limit);
    if (rows.length === 0) return [];

    // metadata.suggestedPlanId → plan code (lote)
    const planIds = [
      ...new Set(
        rows
          .map((r) => (r.metadata as { suggestedPlanId?: string } | null)?.suggestedPlanId)
          .filter((x): x is string => !!x),
      ),
    ];
    const planByIdRows = planIds.length
      ? await dbAdmin
          .select({ id: plans.id, code: plans.code })
          .from(plans)
          .where(inArray(plans.id, planIds))
      : [];
    const planCode = new Map(planByIdRows.map((p) => [p.id, p.code]));

    const clinicIds = rows.map((r) => r.provisionedClinicId).filter((x): x is string => !!x);
    const clinicRows = clinicIds.length
      ? await dbAdmin
          .select({ id: clinics.id, nome: clinics.nome })
          .from(clinics)
          .where(inArray(clinics.id, clinicIds))
      : [];
    const clinicNome = new Map(clinicRows.map((c) => [c.id, c.nome]));

    return rows.map((r) => {
      const sugg = (r.metadata as { suggestedPlanId?: string } | null)?.suggestedPlanId ?? null;
      return {
        id: r.id,
        version: r.version,
        status: r.status,
        email: r.email,
        planCode: sugg ? (planCode.get(sugg) ?? null) : null,
        clinicNome: r.provisionedClinicId ? (clinicNome.get(r.provisionedClinicId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        startedAt: iso(r.startedAt),
        completedAt: iso(r.completedAt),
      };
    });
  }
}

export const invitesRepository = new InvitesRepository();
