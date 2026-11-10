import { redirect } from 'next/navigation';

import { PublicHeading, PublicPage, SignupStage } from '@/components/shared/signup-frame';
import { resolveReadyOwnedSignupOnboarding } from '@/contexts/onboarding';
import { deferredSaasSignupEnabled } from '@/lib/payments/saas/acquisition';

import { PlanSelectionForm } from './plan-selection-form';

export const dynamic = 'force-dynamic';

export default async function SignupPlanPage() {
  const onboarding = await resolveReadyOwnedSignupOnboarding();
  if (!onboarding.ok) redirect('/login');
  if (onboarding.kind === 'redirect') redirect(onboarding.route);
  const trialFirst = deferredSaasSignupEnabled();

  return (
    <PublicPage>
      <SignupStage step={3} trialFirst={trialFirst}>
        <PublicHeading
          title="Escolha seu plano"
          lead={
            trialFirst
              ? 'Escolha o plano que deseja conhecer. Comece a avaliação sem cartão e sem cobrança inicial; a contratação ficará disponível ao final dos 14 dias desde a criação da sua conta.'
              : 'O plano fica salvo no seu cadastro. O pagamento será iniciado somente na próxima etapa, com o valor confirmado no checkout.'
          }
        />
        <PlanSelectionForm />
      </SignupStage>
    </PublicPage>
  );
}
