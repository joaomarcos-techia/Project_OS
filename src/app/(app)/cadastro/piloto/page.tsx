import { notFound } from 'next/navigation';
import { PublicPage, PublicHeading } from '@/components/shared/signup-frame';
import { env } from '@/lib/env';
import { SignupQuestions } from '../signup-questions';

export const dynamic = 'force-dynamic';
export default function PilotSignupPage() {
  if (
    env.ABACATEPAY_PILOT_PROVISIONING_ENABLED !== true ||
    !env.SIGNUP_AUTH_ENABLED ||
    !env.SIGNUP_IDENTITY_ENABLED
  )
    notFound();
  return (
    <PublicPage>
      <PublicHeading
        title="Cadastro da sua clínica"
        lead="Use seu convite individual para confirmar os dados e conhecer o Qoro. Nenhum pagamento é necessário para iniciar a avaliação."
      />
      <SignupQuestions identityEnabled pilot />
    </PublicPage>
  );
}
