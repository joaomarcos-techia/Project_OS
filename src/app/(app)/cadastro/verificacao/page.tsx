import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  PublicBlock,
  PublicHeading,
  PublicPage,
  SignupStage,
} from '@/components/shared/signup-frame';
import { env } from '@/lib/env';
import { isSignupReleaseCheckAvailable } from '@/lib/security/signup-release-check';

import { SignupProtectionCheck } from './signup-protection-check';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SignupProtectionCheckPage() {
  if (!isSignupReleaseCheckAvailable(env.SIGNUP_ENABLED)) notFound();
  return (
    <PublicPage>
      <SignupStage>
        <PublicHeading
          title="Verificar proteção do cadastro"
          lead="Esta verificação confirma a proteção do navegador e do servidor da Qoro. Não cria conta, consulta, assinatura ou cobrança. O cadastro permanece fechado."
        />
        <PublicBlock narrow>
          <SignupProtectionCheck />
        </PublicBlock>
      </SignupStage>
    </PublicPage>
  );
}
