'use client';

import { Eye, EyeOff } from 'lucide-react';
import { Suspense, useActionState, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthScreenSkeleton } from '@/components/shared/auth-screen-skeleton';
import { LoginFrame, LoginIntro, loginFrame } from '@/components/shared/login-frame';
import { signupFrame } from '@/components/shared/signup-frame';
import { TurnstileWidget } from '@/components/shared/turnstile-widget';
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
  inactivity:
    'Sua sessão foi bloqueada depois de 10 minutos sem atividade (perfil de segurança de Convênios). Entre novamente: o rascunho do prontuário ficou salvo.',
  inactivity_unsaved:
    'Sua sessão foi bloqueada depois de 10 minutos sem atividade. Não foi possível confirmar o salvamento das últimas alterações (falha de conexão): confira o rascunho depois de entrar.',
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
  // O formulário de login continua montado na recuperação: o e-mail digitado e o
  // token já resolvido sobrevivem à ida e volta. A recuperação fica FORA dele,
  // porque <form> dentro de <form> faria o navegador descartar o interno.
  const [recovering, setRecovering] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const recoveryTrigger = useRef<HTMLButtonElement>(null);

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

  const closeRecovery = () => {
    setRecovering(false);
    // O gatilho volta a existir só depois do render.
    requestAnimationFrame(() => recoveryTrigger.current?.focus());
  };

  return (
    <LoginFrame showSignup>
      <div className={loginFrame.view} hidden={recovering}>
        <LoginIntro title="Entrar na Qoro" lead="Use o e-mail e a senha do seu acesso." />

        <form ref={formRef} action={formAction} onSubmit={handleSubmit} className={loginFrame.form}>
          {reason && REASONS[reason] ? (
            <Alert variant={reason === 'password_updated' ? 'success' : 'warning'}>
              {REASONS[reason]}
            </Alert>
          ) : null}
          {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

          <Field label="E-mail" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={pending}
              placeholder="voce@suaclinica.com.br"
            />
          </Field>

          <div className={loginFrame.field}>
            <div className={loginFrame.labelRow}>
              <Label htmlFor="password">Senha</Label>
              <button
                ref={recoveryTrigger}
                type="button"
                className={loginFrame.link}
                onClick={() => setRecovering(true)}
              >
                Esqueci a senha
              </button>
            </div>
            <div className={signupFrame.passwordField}>
              <Input
                id="password"
                name="password"
                type={showPw ? 'text' : 'password'}
                required
                autoComplete="current-password"
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                disabled={pending}
                className={signupFrame.passwordToggle}
              >
                {showPw ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
          </div>

          {/* `interaction-only`: invisível para quem a Cloudflare já
              considera humano, e só aparece quando há desafio a resolver.
              Um widget sempre visível no login é atrito diário para
              clínica inteira em troca de nada na esmagadora maioria dos
              acessos. */}
          <TurnstileWidget action="login" resetSignal={captchaAttempt} />

          <div className={loginFrame.submit}>
            <Button type="submit" loading={pending} className="w-full">
              Entrar
            </Button>
            <p className={signupFrame.fine}>
              Recebeu um convite da clínica? Crie a sua senha pelo link do e-mail.
            </p>
          </div>
        </form>
      </div>

      {recovering ? <ForgotPasswordForm onBack={closeRecovery} /> : null}
    </LoginFrame>
  );
}
