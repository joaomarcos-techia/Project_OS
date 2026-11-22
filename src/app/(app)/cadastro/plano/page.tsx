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
      {/* Desenho aprovado no Claude Design ("Cadastro · 3. Checkout"). */}
      <SignupStage step={3} showLogin>
        <PublicHeading
          title="Confirme o plano e o pagamento"
          lead="Confira o plano e a quantidade de médicos. Se quiser, troque antes de continuar."
        />
        <PlanSelectionForm />
      </SignupStage>
    </PublicPage>
  );
}
