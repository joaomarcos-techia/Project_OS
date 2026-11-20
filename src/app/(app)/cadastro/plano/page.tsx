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
      <SignupStage step={3} trialFirst={trialFirst}>
        <PublicHeading
          title="Escolha seu plano"
          lead={
            trialFirst
              ? 'Conheça o sistema por até 14 dias desde a criação da conta, sem cartão e sem cobrança inicial. Se optar por contratar durante a avaliação, confira o valor antes de pagar: o período pago começa após a confirmação do pagamento.'
              : 'O plano fica salvo no seu cadastro. O pagamento será iniciado somente na próxima etapa, com o valor confirmado no checkout.'
          }
        />
        <PlanSelectionForm />
      </SignupStage>
    </PublicPage>
  );
}
