import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicPage } from '@/components/shared/signup-frame';
import { env } from '@/lib/env';
import { SignupQuestions } from '../signup-questions';

export const dynamic = 'force-dynamic';
// Integração #53 -> #56: contrato UX-008 (toda página tem título próprio ou herdado).
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
      {/* Um só título principal: a abertura do convite entra na etapa 1, abaixo da pergunta. */}
      <SignupQuestions
        identityEnabled
        pilot
        intro="Cadastro da sua clínica por convite individual: confirme os dados e conheça o Qoro. Nenhum pagamento é necessário para iniciar a avaliação."
      />
    </PublicPage>
  );
}
