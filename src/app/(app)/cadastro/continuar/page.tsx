import { redirect } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Card, CardContent } from '@/components/ui/card';
import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';

import { ContinueSignupForm } from './continue-signup-form';

export const dynamic = 'force-dynamic';

export default async function ContinueSignupPage() {
  const onboarding = await resolvePreTenantOnboarding();
  if (!onboarding.ok) redirect('/login');
  if (onboarding.kind === 'redirect') redirect(onboarding.route);

  return (
    <main
      data-qoro-tokens="qorov2"
      className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-12 text-fg antialiased"
    >
      <div className="w-full max-w-xl">
        <div className="mb-6 flex justify-center">
          <Logo className="h-7 w-auto" />
        </div>
        <Card>
          <CardContent>
            <h1 className="mb-5 text-balance font-display text-2xl font-semibold">
              Revise seu cadastro
            </h1>
            <ContinueSignupForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
