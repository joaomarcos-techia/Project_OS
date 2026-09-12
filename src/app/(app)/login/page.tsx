'use client';

import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Suspense, useActionState, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/shared/logo';
import { AuthScreenSkeleton } from '@/components/shared/auth-screen-skeleton';
import { loginAction, type LoginActionState } from './actions';
import { AuthProductPreview } from './auth-product-preview';
import { clearPasswordField, clearPasswordFieldAfterSubmit } from './clear-password-field';
import { ForgotPasswordForm } from './forgot-password-form';

const INITIAL: LoginActionState = { error: null };

const SITE = 'https://qoro.dev';

/**
 * `data-qoro-tokens="qorov2"` traz a camada de tokens dos designs de setembro/2026
 * (globals.css) para fora do shell: sem ele o login herda a paleta e a tipografia
 * legadas do `:root` e destoa do restante do produto.
 */
// useSearchParams() força CSR bailout — boundary <Suspense> obrigatório p/ prerender.
export default function LoginPage() {
  return (
    <div data-qoro-tokens="qorov2">
      <Suspense fallback={<AuthScreenSkeleton variant="login" />}>
        <LoginScreen />
      </Suspense>
    </div>
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
    <main className="flex min-h-screen flex-col bg-surface">
      <div className="grid flex-1 grid-cols-1 overflow-hidden bg-surface lg:grid-cols-2">
        {/* ============================ FORM (esquerda) ============================ */}
        <div className="flex min-w-0 flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-10">
          <Logo className="h-auto w-[78px]" />

          <div className="my-auto w-full max-w-[392px] py-10">
            <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.024em] text-fg">
              Entrar na sua conta
            </h1>
            <p className="mt-2 text-[14px] leading-[1.5] text-fg-subtle">
              Bem-vindo de volta. Informe seus dados para continuar.
            </p>

            {reason && REASONS[reason] ? (
              <Alert
                variant={reason === 'password_updated' ? 'success' : 'warning'}
                className="mt-5"
              >
                {REASONS[reason]}
              </Alert>
            ) : null}

            {/*
              `form.contents` dissolve o <form> no flex do container: os campos
              ficam em `order` 0, o gatilho de recuperação em 2 e o Entrar em 3.
              É o que põe "Esqueci a senha" acima do botão, como no design, sem
              aninhar o <form> da recuperação dentro do <form> de login.
            */}
            <div className="mt-7 flex flex-col gap-3.5">
              <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="contents">
                <Field label="E-mail" htmlFor="email">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    disabled={pending}
                    placeholder="voce@clinica.com.br"
                    className="h-11 text-[14px]"
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
                      className="h-11 pr-11 text-[14px]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-(--field-radius) text-fg-subtle transition-colors hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                    >
                      {showPw ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
                </Field>

                {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

                <Button
                  type="submit"
                  loading={pending}
                  className="order-3 mt-1.5 h-[46px] w-full text-[14px] font-semibold"
                >
                  Entrar
                </Button>
              </form>

              <div className="order-2">
                <ForgotPasswordForm />
              </div>
            </div>

            {/* "Cadastre-se" é órfão de propósito (decisão do founder, 2026-09-10):
                o self-serve ainda não existe, e o destino entra depois. Fica como
                texto, não <a> — um link que não navega é pior que nenhum. */}
            <p className="mt-6 text-center text-[13px] leading-none text-fg-subtle">
              Sua clínica ainda não usa a Qoro?{' '}
              <span className="font-semibold text-(--text-link)">Cadastre-se</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[12px] leading-none text-border-strong">
            <span>© {new Date().getFullYear()} Qoro</span>
            <a
              href={`${SITE}/politica-de-privacidade`}
              className="text-inherit no-underline transition-colors hover:text-fg-muted"
            >
              Privacidade
            </a>
            <a
              href={`${SITE}/termos-de-uso`}
              className="text-inherit no-underline transition-colors hover:text-fg-muted"
            >
              Termos
            </a>
            <span className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11.5px] font-medium">
              <ShieldCheck aria-hidden="true" className="size-[13px]" />
              LGPD · dados no Brasil
            </span>
          </div>
        </div>

        {/* ============================ MARCA (direita) ============================ */}
        <aside
          className="relative hidden overflow-hidden lg:flex lg:flex-col"
          style={{
            background:
              'linear-gradient(158deg, oklch(0.5 0.2 266) 0%, oklch(0.44 0.21 268) 42%, oklch(0.36 0.18 270) 100%)',
            padding: '64px 0 0 52px',
          }}
        >
          <div className="relative pr-[52px]">
            <h2 className="max-w-[19ch] font-display text-[31px] font-semibold leading-[1.2] tracking-[-0.028em] text-white">
              Conduza o dia da clínica de um único lugar
            </h2>
            <p
              className="mt-3.5 max-w-[44ch] text-[14.5px] leading-[1.55]"
              style={{ color: 'oklch(0.91 0.05 268)' }}
            >
              Entre para acompanhar agenda, prontuários, documentos e caixa em tempo real.
            </p>
          </div>

          <AuthProductPreview />
        </aside>
      </div>
    </main>
  );
}
