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

// Telas terminais usando o MESMO design do wizard (.wiz/.wiz-card/.btn) — antes
// eram Tailwind cru, destoando do fluxo (item 5 do lote).
function InvalidJoin({ reason }: { reason: string }) {
  return (
    <div className="wiz scene-anim">
      <div className="wiz-main">
        <div className="wiz-card done">
          <h1>Convite indisponível</h1>
          <p>{reason}</p>
          <p className="foot-secure">Peça um novo link ao administrador da plataforma.</p>
        </div>
      </div>
    </div>
  );
}

function AlreadyActivated() {
  return (
    <div className="wiz scene-anim">
      <div className="wiz-main">
        <div className="wiz-card done">
          <div className="mark">🎉</div>
          <h1>Clínica já ativada</h1>
          <p>Este convite já foi concluído. Sua clínica está pronta.</p>
          <a className="btn block" href="/dashboard" style={{ marginTop: 'var(--sp-6)' }}>
            Entrar no painel
          </a>
        </div>
      </div>
    </div>
  );
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const rl = await assertJoinAllowed(getClientIp(await headers()));
  if (!rl.ok)
    return <InvalidJoin reason="Muitas tentativas. Aguarde alguns minutos e tente de novo." />;

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
