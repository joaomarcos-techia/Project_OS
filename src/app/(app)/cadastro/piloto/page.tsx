import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicPage } from '@/components/shared/signup-frame';
import { env } from '@/lib/env';
import { SignupQuestions } from '../signup-questions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Cadastro por convite' };
export default function PilotSignupPage() {
  if (
    env.ABACATEPAY_PILOT_PROVISIONING_ENABLED !== true ||
    !env.SIGNUP_AUTH_ENABLED ||
    !env.SIGNUP_IDENTITY_ENABLED
  )
    notFound();
  return (
    <PublicPage>
      {/* Um só título principal: o `h1` é o da pergunta, dentro de SignupQuestions. A abertura
          do convite é um parágrafo, não outro `h1` (pendência de acessibilidade do ciclo 9). */}
      <p className="mx-auto max-w-[52ch] text-pretty text-center text-sm leading-relaxed text-fg-muted">
        <strong className="font-semibold text-fg">Cadastro da sua clínica.</strong> Use seu convite
        individual para confirmar os dados e conhecer o Qoro. Nenhum pagamento é necessário para
        iniciar a avaliação.
      </p>
      <SignupQuestions identityEnabled pilot />
    </PublicPage>
  );
}
