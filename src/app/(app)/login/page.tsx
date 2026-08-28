'use client';

import { Eye, EyeOff } from 'lucide-react';
import { Suspense, useActionState, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/shared/logo';
import { AuthScreenSkeleton } from '@/components/shared/auth-screen-skeleton';
import { loginAction, type LoginActionState } from './actions';
import { clearPasswordField, clearPasswordFieldAfterSubmit } from './clear-password-field';
import { ForgotPasswordForm } from './forgot-password-form';

const INITIAL: LoginActionState = { error: null };

// useSearchParams() força CSR bailout — boundary <Suspense> obrigatório p/ prerender.
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthScreenSkeleton variant="login" />}>
      <LoginScreen />
    </Suspense>
  );
}

const REASONS: Record<string, string> = {
  drift: 'Sua sessão foi invalidada por mudança de permissões. Faça login novamente.',
  disabled: 'Seu acesso foi desativado. Contate o administrador.',
  no_profile: 'Profile não encontrado. Contate o administrador.',
  password_updated: 'Senha atualizada. Entre novamente com sua nova senha.',
};

function LoginScreen() {
  const params = useSearchParams();
  const reason = params.get('reason');
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);
  const [showPw, setShowPw] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) return;
    clearPasswordField(formRef.current);
    setShowPw(false);
  }, [state]);

  const handleSubmit = () => {
    clearPasswordFieldAfterSubmit(formRef.current);
    setShowPw(false);
  };

  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-2">
      {/* ============================ FORM (esquerda) ============================ */}
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        <div className="flex items-center">
          <Logo className="h-7 w-auto" />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">Bem-vindo de volta</h1>
            <p className="mt-2 text-sm text-fg-muted">
              Entre com seu e-mail e senha para acessar sua clínica.
            </p>

            {reason && REASONS[reason] ? (
              <Alert
                variant={reason === 'password_updated' ? 'success' : 'warning'}
                className="mt-5"
              >
                {REASONS[reason]}
              </Alert>
            ) : null}

            <form
              ref={formRef}
              action={formAction}
              onSubmit={handleSubmit}
              className="mt-6 flex flex-col gap-4"
            >
              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  disabled={pending}
                  placeholder="voce@clinica.com.br"
                />
              </Field>

              <Field label="Senha" htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPw ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    disabled={pending}
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-0 top-1/2 flex size-(--hit-target) -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle transition-colors hover:text-fg"
                  >
                    {showPw ? (
                      <EyeOff aria-hidden="true" className="size-4.5" />
                    ) : (
                      <Eye aria-hidden="true" className="size-4.5" />
                    )}
                  </button>
                </div>
              </Field>

              {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

              <Button type="submit" loading={pending} className="w-full">
                Entrar
              </Button>
            </form>

            <ForgotPasswordForm />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-fg-subtle">
          <span>© {new Date().getFullYear()} Qoro</span>
          <span className="font-mono">Operação sem vazamento</span>
        </div>
      </div>

      {/* ============================ MARCA (direita) ============================ */}
      <aside
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center"
        style={{
          background:
            'linear-gradient(155deg, var(--primary-600) 0%, var(--primary-700) 55%, var(--primary-800) 100%)',
        }}
      >
        {/* textura em grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '46px 46px',
            WebkitMaskImage: 'radial-gradient(120% 80% at 72% 8%, #000 0%, transparent 62%)',
            maskImage: 'radial-gradient(120% 80% at 72% 8%, #000 0%, transparent 62%)',
          }}
        />
        {/* brilho teal (acento memorável, com parcimônia) */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full"
          style={{
            background:
              'radial-gradient(circle, color-mix(in oklch, var(--brand-accent-500) 55%, transparent), transparent 70%)',
          }}
        />

        <div className="relative z-10 px-12 xl:px-16">
          <h2 className="max-w-md text-balance text-3xl font-semibold leading-tight tracking-tight text-white xl:text-4xl">
            Gerencie sua clínica sem vazamentos.
          </h2>
          <p className="mt-4 max-w-md text-pretty text-base leading-relaxed text-white/70">
            Entre para acessar o painel e operar agenda, atendimento e caixa em tempo real.
          </p>
        </div>
      </aside>
    </main>
  );
}
