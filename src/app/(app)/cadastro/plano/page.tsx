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
      {/* Desenho aprovado no Claude Design ("Cadastro · 3. Checkout"). */}
      <SignupStage step={3} showLogin trialFirst={trialFirst}>
        <PublicHeading
          title={trialFirst ? 'Escolha seu plano' : 'Confirme o plano e o pagamento'}
          lead={
            trialFirst
              ? 'Confira o plano e a quantidade de médicos. Sua avaliação começa sem cartão; a contratação é feita depois, com o valor confirmado antes de pagar.'
              : 'Confira o plano e a quantidade de médicos. Se quiser, troque antes de continuar.'
          }
        />
        <PlanSelectionForm />
      </SignupStage>
    </PublicPage>
  );
}
