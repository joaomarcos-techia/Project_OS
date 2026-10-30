import 'server-only';

import { z } from 'zod';

/* eslint-disable boundaries/element-types -- onboarding resolve o contrato do plano no servidor. */
import { isOffer2026PlanCode, PROPOSED_OFFER } from '@/contexts/billing/proposed-offer';
/* eslint-enable boundaries/element-types */
import { createServerClient } from '@/lib/auth/supabase-server';

import { QORO_SELF_SERVICE_TRIAL_DAYS } from '../trial';

const userIdSchema = z.string().uuid();

/** O marco do trial novo é imutável e vem do Auth, nunca do draft ou do navegador. */
export async function readSignupAuthCreatedAt(userId: string): Promise<Date | null> {
  if (!userIdSchema.safeParse(userId).success) return null;

  try {
    const { data, error } = await (await createServerClient()).auth.getUser();
    if (error || !data.user || data.user.id !== userId) return null;

    const timestamp = Date.parse(data.user.created_at);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  } catch {
    // Falha fechada: planos versionados não podem avançar sem o marco do Auth.
    return null;
  }
}

/** Planos legados mantêm seu relógio atual, ancorado na tentativa de checkout. */
export function legacySignupTrialEnd(attemptedAt: Date): Date {
  return new Date(attemptedAt.getTime() + QORO_SELF_SERVICE_TRIAL_DAYS * 86_400_000);
}

export interface SignupTrialTerms {
  endsAt: Date;
  firstDueDate: string;
  days: number;
  strictDeadline: boolean;
  expiredAtCheckout: boolean;
}

/**
 * O Asaas recebe apenas YYYY-MM-DD. No plano novo, a cobrança fica no dia UTC
 * seguinte ao fim exato do trial; se o checkout ocorre depois do fim, vence hoje.
 * O vencimento tardio só pode liberar a clínica após readback de pagamento.
 */
export function resolveSignupTrialTerms(input: {
  planCode: string;
  attemptedAt: Date;
  authCreatedAt?: Date | null;
}): SignupTrialTerms | null {
  if (!Number.isFinite(input.attemptedAt.getTime())) return null;
  if (!isOffer2026PlanCode(input.planCode)) {
    const endsAt = legacySignupTrialEnd(input.attemptedAt);
    return {
      endsAt,
      firstDueDate: endsAt.toISOString().slice(0, 10),
      days: QORO_SELF_SERVICE_TRIAL_DAYS,
      strictDeadline: false,
      expiredAtCheckout: false,
    };
  }

  const createdAt = input.authCreatedAt;
  if (
    !createdAt ||
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.getTime() > input.attemptedAt.getTime()
  )
    return null;
  const endsAt = new Date(createdAt.getTime() + PROPOSED_OFFER.proposedTrialDays * 86_400_000);
  const expiredAtCheckout = input.attemptedAt.getTime() >= endsAt.getTime();
  const firstDueDate = expiredAtCheckout
    ? input.attemptedAt.toISOString().slice(0, 10)
    : new Date(endsAt.getTime() + 86_400_000).toISOString().slice(0, 10);
  return {
    endsAt,
    firstDueDate,
    days: PROPOSED_OFFER.proposedTrialDays,
    strictDeadline: true,
    expiredAtCheckout,
  };
}
