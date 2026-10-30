import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { env } from '@/lib/env';
import { isSignupReleaseCheckAvailable } from '@/lib/security/signup-release-check';

import { SignupProtectionCheck } from './signup-protection-check';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SignupProtectionCheckPage() {
  if (!isSignupReleaseCheckAvailable(env.SIGNUP_ENABLED)) notFound();
  return (
    <main data-qoro-tokens="qorov2" className="min-h-screen bg-surface px-5 py-8 text-fg">
      <div className="mx-auto w-full max-w-xl">
        <Logo className="mb-8 h-auto w-[78px]" />
        <h1 className="font-display text-2xl font-semibold">Verificar proteção do cadastro</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          Esta verificação confirma a proteção do navegador e do servidor da Qoro. Não cria conta,
          consulta, assinatura ou cobrança. O cadastro permanece fechado.
        </p>
        <SignupProtectionCheck />
      </div>
    </main>
  );
}
