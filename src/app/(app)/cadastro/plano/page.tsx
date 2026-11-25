import { redirect } from 'next/navigation';

import { PublicHeading, PublicPage, SignupStage } from '@/components/shared/signup-frame';
import { resolveReadyOwnedSignupOnboarding, readPilotSignupPlan } from '@/contexts/onboarding';
import { deferredSaasSignupEnabled } from '@/lib/payments/saas/acquisition';

import { PlanSelectionForm } from './plan-selection-form';

export const dynamic = 'force-dynamic';

export default async function SignupPlanPage() {
  const onboarding = await resolveReadyOwnedSignupOnboarding();
  if (!onboarding.ok) redirect('/login');
  if (onboarding.kind === 'redirect') redirect(onboarding.route);
  const trialFirst =
    deferredSaasSignupEnabled() || Boolean(await readPilotSignupPlan(onboarding.userId));

  return (
    <PublicPage>
      {/* Com cartão: desenho aprovado no Claude Design ("Cadastro · 3. Checkout"). No trial_first
          do #53 (sem cartão nesta etapa), o título e o texto da avaliação. */}
      <SignupStage step={3} showLogin trialFirst={trialFirst}>
        {trialFirst ? (
          <PublicHeading
            title="Escolha seu plano"
            lead="Conheça o sistema por até 14 dias desde a criação da conta, sem cartão e sem cobrança inicial. Se optar por contratar durante a avaliação, confira o valor antes de pagar: o período pago começa após a confirmação do pagamento."
          />
        ) : (
          <PublicHeading
            title="Confirme o plano e o pagamento"
            lead="Confira o plano e a quantidade de médicos. Se quiser, troque antes de continuar."
          />
        )}
        <PlanSelectionForm />
      </SignupStage>
    </PublicPage>
  );
}
