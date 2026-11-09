'use client';

import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useActionState, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/shared/logo';
import { AuthScreenSkeleton } from '@/components/shared/auth-screen-skeleton';
import { TurnstileWidget } from '@/components/shared/turnstile-widget';
import { loginAction, type LoginActionState } from './actions';
import { AuthProductPreview } from './auth-product-preview';
import { clearPasswordField, clearPasswordFieldAfterSubmit } from './clear-password-field';
import { ForgotPasswordForm } from './forgot-password-form';

const INITIAL: LoginActionState = { error: null };

const SITE = 'https://qoro.dev';

/**
 * `data-qoro-tokens="app-v5"` traz os tokens do app atual (globals.css) para fora
 * do shell: o login abre com a mesma paleta e tipografia da área logada. O cadastro
 * segue em `qorov2` até o redesenho do onboarding.
 */
// useSearchParams() força CSR bailout — boundary <Suspense> obrigatório p/ prerender.
export default function LoginPage() {
  return (
    <div data-qoro-tokens="app-v5">
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
  // O token do Turnstile é DE USO ÚNICO. Sem este contador, a segunda tentativa
  // reenviaria o token já gasto e levaria `timeout-or-duplicate` — o usuário
  // veria "verificação de segurança" com a senha certa.
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) return;
    setCaptchaAttempt((n) => n + 1);
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
          <Logo className="h-auto w-[78px] text-fg" />

          {/* `mx-auto` centra o formulário na faixa branca. Sem ele o bloco de
              392px encostava na borda do padding, e a coluna esquerda ficava
              com todo o respiro à direita e nenhum à esquerda. */}
          <div className="mx-auto my-auto w-full max-w-[392px] py-10">
            <h1 className="font-display text-(length:--fs-page) font-semibold leading-[1.2] tracking-[-0.02em] text-fg">
              Entrar na sua conta
            </h1>
            <p className="mt-1 text-[14px] leading-[1.5] text-fg-muted">
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

                {/* `interaction-only`: invisível para quem a Cloudflare já
                    considera humano, e só aparece quando há desafio a resolver.
                    Um widget sempre visível no login é atrito diário para
                    clínica inteira em troca de nada na esmagadora maioria dos
                    acessos. */}
                <TurnstileWidget action="login" resetSignal={captchaAttempt} />

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

            <p className="mt-6 text-center text-[13px] leading-none text-fg-subtle">
              Sua clínica ainda não usa a Qoro?{' '}
              <Link
                href="/cadastro"
                className="inline-flex min-h-10 items-center font-semibold text-(--text-link) underline-offset-4 hover:underline focus-visible:rounded-(--r-sm) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
              >
                Cadastre-se
              </Link>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[12px] leading-none text-fg-subtle">
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
            <span className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium">
              <ShieldCheck aria-hidden="true" className="size-[13px]" />
              LGPD · dados no Brasil
            </span>
          </div>
        </div>

        {/* ============================ MARCA (direita) ============================ */}
        {/* O painel é um cartão dentro da célula do grid, não a célula inteira:
            `m-*` cria a faixa branca entre a borda da tela e a arte, e o raio
            arredonda os quatro cantos. Antes ele sangrava até as bordas. */}
        <aside
          className="relative m-3 hidden overflow-hidden rounded-(--panel-radius) lg:flex lg:flex-col"
          // O azul é literal: a arte da marca não muda com o tema de quem acessa.
          style={{ background: '#1A1ED5', padding: '64px 0 0 52px' }}
        >
          <div className="relative pr-[52px]">
            <h2 className="max-w-[19ch] font-display text-[31px] font-semibold leading-[1.2] tracking-[-0.02em] text-white">
              Conduza o dia da clínica de um único lugar
            </h2>
            <p
              className="mt-3.5 max-w-[44ch] text-[14.5px] leading-[1.55]"
              style={{ color: '#D6D8FA' }}
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
