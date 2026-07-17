'use client';

import { Suspense, useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/shared/logo';
import { loginAction, type LoginActionState } from './actions';

const INITIAL: LoginActionState = { error: null };

// useSearchParams() força CSR bailout — boundary <Suspense> obrigatório p/ prerender.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}

const REASONS: Record<string, string> = {
  drift: 'Sua sessão foi invalidada por mudança de permissões. Faça login novamente.',
  disabled: 'Seu acesso foi desativado. Contate o administrador.',
  no_profile: 'Profile não encontrado. Contate o administrador.',
};

function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

function LoginScreen() {
  const params = useSearchParams();
  const reason = params.get('reason');
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);
  const [showPw, setShowPw] = useState(false);

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
              <Alert variant="warning" className="mt-5">
                {REASONS[reason]}
              </Alert>
            ) : null}

            <form action={formAction} className="mt-6 flex flex-col gap-4">
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
                    style={{ paddingRight: '2.5rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle transition-colors hover:text-fg"
                  >
                    <EyeIcon off={showPw} />
                  </button>
                </div>
              </Field>

              <div className="flex items-center justify-end">
                <a
                  href="/forgot-password"
                  className="text-sm font-medium text-primary-600 hover:text-primary-700"
                >
                  Esqueci minha senha
                </a>
              </div>

              {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

              <Button type="submit" loading={pending} className="w-full">
                Entrar
              </Button>
            </form>
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
              'radial-gradient(circle, color-mix(in oklch, var(--accent-500) 55%, transparent), transparent 70%)',
          }}
        />

        <div className="relative z-10 px-12 xl:px-16">
          <h2 className="max-w-md text-[2.1rem] font-semibold leading-[1.12] tracking-[-0.03em] text-white xl:text-[2.5rem]">
            Gerencie sua clínica sem vazamentos.
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
            Entre para acessar o painel e operar agenda, atendimento e caixa em tempo real.
          </p>
        </div>
      </aside>
    </main>
  );
}
