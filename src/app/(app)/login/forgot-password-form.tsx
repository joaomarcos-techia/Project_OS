'use client';

import { ArrowLeft } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { LoginIntro, loginFrame } from '@/components/shared/login-frame';
import { signupFrame } from '@/components/shared/signup-frame';
import { TurnstileWidget } from '@/components/shared/turnstile-widget';

import { forgotPasswordAction, type ForgotPasswordActionState } from './actions';

const INITIAL: ForgotPasswordActionState = { error: null, sent: false };

/**
 * Recuperação na própria rota de login: evita link sem grant.
 *
 * Fica FORA do `<form>` de login (form aninhado é HTML inválido). A resposta é a
 * mesma exista ou não a conta, e o texto de envio não pode afirmar o contrário.
 */
export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL);
  // Token do Turnstile é de uso único: cada envio precisa de um novo.
  const [captchaAttempt, setCaptchaAttempt] = useState(0);

  useEffect(() => {
    if (state.sent || state.error) setCaptchaAttempt((n) => n + 1);
  }, [state]);

  if (state.sent) {
    return (
      <div className={loginFrame.view}>
        <LoginIntro
          title="Confira o seu e-mail"
          lead="Abra o link do e-mail para criar uma senha nova."
        />
        <div className={loginFrame.form}>
          <Alert variant="success">
            Se houver uma conta para esse endereço, o link será enviado.
          </Alert>
          <p className={signupFrame.text}>Não chegou em alguns minutos? Confira a caixa de spam.</p>
          <div className={signupFrame.actions}>
            <Button type="button" variant="ghost" onClick={onBack}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Voltar para o login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={loginFrame.view}>
      <LoginIntro
        title="Redefinir a senha"
        lead="Informe o e-mail do seu acesso. Vamos enviar um link para você criar uma senha nova."
      />
      <form action={formAction} className={loginFrame.form}>
        <Field label="E-mail" htmlFor="recovery-email">
          <Input
            id="recovery-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            disabled={pending}
            placeholder="voce@suaclinica.com.br"
          />
        </Field>
        <TurnstileWidget action="recovery" resetSignal={captchaAttempt} />
        {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
        <div className={loginFrame.submit}>
          <div className={signupFrame.actions}>
            <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              Voltar
            </Button>
            <Button type="submit" loading={pending} className="flex-1">
              Enviar link
            </Button>
          </div>
          <p className={signupFrame.fine}>
            É da equipe e não sabe qual e-mail usa? Peça para quem administra a clínica conferir em
            Equipe &amp; Permissões.
          </p>
        </div>
      </form>
    </div>
  );
}
