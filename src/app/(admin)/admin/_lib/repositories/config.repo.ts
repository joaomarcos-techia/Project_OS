/**
 * ConfigRepository (C15) — leitura read-only do catálogo de planos/preços/limites.
 * Único ponto que toca dbAdmin para esta área.
 *
 * Server-only.
 */
import 'server-only';

import { asc, isNull } from 'drizzle-orm';

import { planLimits, plans, prices } from '@/contexts/billing/schema';
import { dbAdmin } from '@/lib/db';

import { toCents } from '../format';

export interface PlanConfigDTO {
  id: string;
  code: string;
  name: string;
  ativo: boolean;
  prices: { cycle: string; amountCents: number }[];
  limits: { metric: string; value: number }[];
}

export class ConfigRepository {
  async getPlans(): Promise<PlanConfigDTO[]> {
    const planRows = await dbAdmin
      .select({ id: plans.id, code: plans.code, name: plans.name, ativo: plans.ativo })
      .from(plans)
      .orderBy(asc(plans.code));

    const priceRows = await dbAdmin
      .select({ planId: prices.planId, amount: prices.amount, cycle: prices.billingCycle })
      .from(prices)
      .where(isNull(prices.activeUntil));

    const limitRows = await dbAdmin
      .select({ planId: planLimits.planId, metric: planLimits.metric, value: planLimits.limitValue })
      .from(planLimits);

    return planRows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      ativo: p.ativo,
      prices: priceRows
        .filter((pr) => pr.planId === p.id)
        .map((pr) => ({ cycle: pr.cycle, amountCents: toCents(pr.amount) })),
      limits: limitRows
        .filter((l) => l.planId === p.id)
        .map((l) => ({ metric: l.metric, value: l.value })),
    }));
  }
}

export const configRepository = new ConfigRepository();
