import { redirect } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Card, CardContent } from '@/components/ui/card';
import { resolveSignupDraftEntry } from '@/contexts/onboarding';

import { ContinueSignupForm } from './continue-signup-form';

export const dynamic = 'force-dynamic';

export default async function ContinueSignupPage() {
  const onboarding = await resolveSignupDraftEntry();
  if (!onboarding.ok) {
    if (
      onboarding.reason === 'invalid_session' ||
      onboarding.reason === 'anonymous' ||
      onboarding.reason === 'email_unverified'
    ) {
      redirect('/login');
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4 text-fg">
        <Card className="w-full max-w-xl">
          <CardContent className="space-y-3 py-6">
            <h1 className="font-display text-xl font-semibold">
              Não foi possível retomar o cadastro
            </h1>
            <p>
              Não conseguimos confirmar o vínculo desta conta com um cadastro em andamento. Atualize
              a página para tentar novamente. Se persistir, entre novamente. Caso o problema
              continue, fale com o suporte.
            </p>
            <a href="/login" className="text-sm font-medium text-primary underline">
              Ir para o login
            </a>
          </CardContent>
        </Card>
      </main>
    );
  }
  if (onboarding.kind === 'redirect') redirect(onboarding.route);
  // O vínculo do draft NÃO acontece aqui: renderizar é leitura, e escrever no
  // render ficaria fora do rate limit e engoliria a falha. Um draft recriado
  // recebe o vínculo após o POST limitado; o GET abaixo apenas consulta.

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
