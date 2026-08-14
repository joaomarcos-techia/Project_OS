'use server';

import { headers } from 'next/headers';

import {
  getInviteStatus,
  guardedUpdateInvite,
  listOnboardingPlans,
  parseStepState,
  resolveOpenInvite,
  type OnboardingPlan,
} from '@/contexts/onboarding';
import type { StepState } from '@/contexts/onboarding/internal/step-state';
import { assertJoinAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { isOnboardingInviteToken } from '@/lib/auth/onboarding-invite-fragment';
import { metrics } from '@/lib/observability/metrics';

export type JoinBootstrapResult =
  | {
      kind: 'ready';
      initialState: StepState;
      suggestedEmail: string | null;
      suggestedPlanId: string | null;
      plans: OnboardingPlan[];
    }
  | { kind: 'invalid'; reason: string }
  | { kind: 'completed' };

/**
 * Resolve o token que veio do fragmento no browser. O GET inicial de `/join`
 * não contém segredo; este é o primeiro ponto que o token alcança o servidor.
 */
export async function bootstrapJoinAction(rawToken: string): Promise<JoinBootstrapResult> {
  const rl = await assertJoinAllowed(getClientIp(await headers()));
  if (!rl.ok) {
    return {
      kind: 'invalid',
      reason: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    };
  }
  if (!isOnboardingInviteToken(rawToken)) {
    return { kind: 'invalid', reason: 'Este convite é inválido, expirou ou já foi utilizado.' };
  }

  const invite = await resolveOpenInvite(rawToken);
  if (!invite) {
    const peek = await getInviteStatus(rawToken);
    return peek?.status === 'completed'
      ? { kind: 'completed' }
      : { kind: 'invalid', reason: 'Este convite é inválido, expirou ou já foi utilizado.' };
  }

  if (invite.status === 'pending') {
    await guardedUpdateInvite(invite.id, invite.version, {
      status: 'started',
      startedAt: new Date(),
    });
    metrics.emit('onboarding.started', { inviteId: invite.id });
  }

  const meta = invite.metadata as { suggestedPlanId?: string | null } | null;
  return {
    kind: 'ready',
    initialState: parseStepState(invite.stepState),
    suggestedEmail: invite.email,
    suggestedPlanId: meta?.suggestedPlanId ?? null,
    plans: await listOnboardingPlans(),
  };
}
