import { redirect } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Card, CardContent } from '@/components/ui/card';
import { resolveReadyOwnedSignupOnboarding } from '@/contexts/onboarding';

import { ContinueSignupForm } from './continue-signup-form';

export const dynamic = 'force-dynamic';

export default async function ContinueSignupPage() {
  const onboarding = await resolveReadyOwnedSignupOnboarding();
  if (!onboarding.ok) redirect('/login');
  if (onboarding.kind === 'redirect') redirect(onboarding.route);
  // O vínculo do draft NÃO acontece aqui: renderizar é leitura, e escrever no
  // render ficaria fora do rate limit e engoliria a falha. Quem vincula é o
  // `GET /api/signup/draft` chamado pelo formulário abaixo.

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
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Etapa 4 · revisão
            </p>
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
