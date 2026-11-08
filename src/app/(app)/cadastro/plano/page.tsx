import { redirect } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Card, CardContent } from '@/components/ui/card';
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
    <main
      data-qoro-tokens="qorov2"
      className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-4 text-fg antialiased sm:py-6"
    >
      <div className="w-full max-w-5xl">
        <div className="mb-4 flex justify-center">
          <Logo className="h-7 w-auto" />
        </div>
        <Card>
          <CardContent>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Etapa 5 · plano
            </p>
            <h1 className="text-balance font-display text-2xl font-semibold">Escolha seu plano</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-muted">
              {trialFirst
                ? 'Escolha o plano que deseja conhecer. Comece a avaliação sem cartão e sem cobrança inicial; a contratação ficará disponível ao final dos 14 dias desde a criação da sua conta.'
                : 'O plano fica salvo no seu cadastro. O pagamento será iniciado somente na próxima etapa, com o valor confirmado no checkout.'}
            </p>
            <div className="mt-4">
              <PlanSelectionForm />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
