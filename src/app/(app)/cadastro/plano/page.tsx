import { redirect } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Card, CardContent } from '@/components/ui/card';
import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';

import { PlanSelectionForm } from './plan-selection-form';

export const dynamic = 'force-dynamic';

export default async function SignupPlanPage() {
  const onboarding = await resolvePreTenantOnboarding();
  if (!onboarding.ok) redirect('/login');
  if (onboarding.kind === 'redirect') redirect(onboarding.route);

  return (
    <main
      data-qoro-tokens="qorov2"
      className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10 text-fg antialiased sm:py-12"
    >
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex justify-center">
          <Logo className="h-7 w-auto" />
        </div>
        <Card>
          <CardContent>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Cadastro da clínica
            </p>
            <h1 className="text-balance font-display text-2xl font-semibold">Escolha seu plano</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
              O plano fica salvo no seu cadastro. O pagamento será iniciado somente na próxima
              etapa, com o valor confirmado no checkout.
            </p>
            <div className="mt-6">
              <PlanSelectionForm />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
