import { redirect } from 'next/navigation';

import { PublicHeading, PublicPage, SignupStage } from '@/components/shared/signup-frame';
import { resolveReadyOwnedSignupOnboarding } from '@/contexts/onboarding';

import { PlanSelectionForm } from './plan-selection-form';

export const dynamic = 'force-dynamic';

export default async function SignupPlanPage() {
  const onboarding = await resolveReadyOwnedSignupOnboarding();
  if (!onboarding.ok) redirect('/login');
  if (onboarding.kind === 'redirect') redirect(onboarding.route);

  return (
    <PublicPage>
      <SignupStage step={3}>
        <PublicHeading
          title="Escolha seu plano"
          lead={
            <>
              O plano fica salvo no seu cadastro. O pagamento será iniciado somente na próxima
              etapa, com o valor confirmado no checkout.
            </>
          }
        />
        <PlanSelectionForm />
      </SignupStage>
    </PublicPage>
  );
}
