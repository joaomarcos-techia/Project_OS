import { Logo } from '@/components/shared/logo';
import { env } from '@/lib/env';

import { SignupQuestions } from './signup-questions';

export const dynamic = 'force-dynamic';

export default function CadastroPage() {
  return (
    <main data-qoro-tokens="qorov2" className="min-h-screen bg-surface text-fg antialiased">
      <header className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-5 py-6 sm:px-8">
        <Logo className="h-auto w-[78px]" />
        <span className="font-mono text-xs font-medium text-fg-subtle">Cadastro seguro</span>
      </header>
      <SignupQuestions identityEnabled={env.SIGNUP_IDENTITY_ENABLED} />
    </main>
  );
}
