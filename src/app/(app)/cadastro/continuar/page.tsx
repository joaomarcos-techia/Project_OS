import { redirect } from 'next/navigation';

import {
  PublicBlock,
  PublicHeading,
  PublicPage,
  SignupStage,
  signupFrame,
} from '@/components/shared/signup-frame';
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
      <PublicPage>
        <SignupStage>
          <PublicHeading title="Não foi possível retomar o cadastro" />
          <PublicBlock narrow>
            <p className={signupFrame.text}>
              Não conseguimos confirmar o vínculo desta conta com um cadastro em andamento. Atualize
              a página para tentar novamente. Se persistir, entre novamente. Caso o problema
              continue, fale com o suporte.
            </p>
            <a href="/login" className={signupFrame.inlineLink}>
              Ir para o login
            </a>
          </PublicBlock>
        </SignupStage>
      </PublicPage>
    );
  }
  if (onboarding.kind === 'redirect') redirect(onboarding.route);
  // O vínculo do draft NÃO acontece aqui: renderizar é leitura, e escrever no
  // render ficaria fora do rate limit e engoliria a falha. Um draft recriado
  // recebe o vínculo após o POST limitado; o GET abaixo apenas consulta.

  return (
    <PublicPage>
      <SignupStage step={2}>
        <PublicHeading title="Revise seu cadastro" />
        <PublicBlock>
          <ContinueSignupForm />
        </PublicBlock>
      </SignupStage>
    </PublicPage>
  );
}
