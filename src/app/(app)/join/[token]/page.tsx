/**
 * `/join/[token]` — onboarding público via convite mágico (F1). SEM sessão: a "auth"
 * é o token validado server-side + rate-limit. Valida → marca `started` na 1ª abertura
 * (guardado por version) → renderiza o wizard. Inválido/expirado/usado → tela neutra.
 */
import { headers } from 'next/headers';

import {
  getInviteStatus,
  guardedUpdateInvite,
  listOnboardingPlans,
  parseStepState,
  resolveOpenInvite,
} from '@/contexts/onboarding';
import { assertJoinAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { metrics } from '@/lib/observability/metrics';

import { JoinWizard } from './join-wizard';

export const dynamic = 'force-dynamic';

function InvalidJoin({ reason }: { reason: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-fg">Convite indisponível</h1>
      <p className="mt-2 text-sm text-fg-muted">{reason}</p>
      <p className="mt-4 text-xs text-fg-subtle">Peça um novo link ao administrador da plataforma.</p>
    </div>
  );
}

function AlreadyActivated() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-fg">Clínica já ativada 🎉</h1>
      <p className="mt-2 text-sm text-fg-muted">Este convite já foi concluído. Sua clínica está pronta.</p>
      <a href="/dashboard" className="mt-5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white">
        Entrar no painel
      </a>
    </div>
  );
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const rl = await assertJoinAllowed(getClientIp(await headers()));
  if (!rl.ok) return <InvalidJoin reason="Muitas tentativas. Aguarde alguns minutos e tente de novo." />;

  const invite = await resolveOpenInvite(token);
  if (!invite) {
    // Distingue "já ativada" (completed) de inválido/expirado — UX pós-ativação.
    const peek = await getInviteStatus(token);
    if (peek?.status === 'completed') return <AlreadyActivated />;
    return <InvalidJoin reason="Este convite é inválido, expirou ou já foi utilizado." />;
  }

  // Marca `started` na 1ª abertura (guardado por version — idempotente em re-render).
  if (invite.status === 'pending') {
    await guardedUpdateInvite(invite.id, invite.version, {
      status: 'started',
      startedAt: new Date(),
    });
    metrics.emit('onboarding.started', { inviteId: invite.id });
  }

  const plans = await listOnboardingPlans();
  const meta = invite.metadata as { suggestedPlanId?: string | null } | null;
  return (
    <JoinWizard
      token={token}
      initialState={parseStepState(invite.stepState)}
      suggestedEmail={invite.email}
      suggestedPlanId={meta?.suggestedPlanId ?? null}
      plans={plans}
    />
  );
}
