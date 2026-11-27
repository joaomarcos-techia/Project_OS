'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useActionState, useState, type FormEvent } from 'react';

import { loginFrame } from '@/components/shared/login-frame';
import { signupFrame } from '@/components/shared/signup-frame';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SIGNUP_PASSWORD_RULES, signupPasswordMessage } from '@/lib/auth/signup-password';

import { resetPasswordAction, type ResetState } from './actions';

const INITIAL: ResetState = { error: null };

/**
 * Só o formulário. A decisão de mostrá-lo é do Server Component (AUTH-006):
 * este componente não valida token nem estabelece sessão — se ele renderizou,
 * o grant de recovery já foi verificado no servidor.
 *
 * `username` vai num campo oculto com `autocomplete="username"`: é assim que o
 * gerenciador de senhas liga a senha nova à conta e atualiza a salva. Sem ele,
 * o login seguinte vinha preenchido com a senha ANTIGA.
 *
 * As peças são as do login (campo com o olho, dica, botão inteiro): quem chega
 * pelo e-mail reconhece a mesma tela em que vai entrar depois.
 */
export function ResetPasswordForm({ username }: { username?: string | null }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL);
  const [showPw, setShowPw] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  // A regra é a mesma do servidor; checar aqui só poupa a ida e volta e mostra
  // o motivo exato (maiúscula, número...) em vez do balão genérico do navegador.
  function checkPassword(event: FormEvent<HTMLFormElement>) {
    const password = new FormData(event.currentTarget).get('password');
    const message = signupPasswordMessage(typeof password === 'string' ? password : '');
    setClientError(message);
    if (message) event.preventDefault();
  }

  const error = clientError ?? state.error;

  return (
    <form action={formAction} onSubmit={checkPassword} className={loginFrame.form}>
      {username ? (
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          hidden
        />
      ) : null}
      <Field
        label="Nova senha"
        htmlFor="password"
        hint={`${SIGNUP_PASSWORD_RULES} Senhas comuns ou que já apareceram em vazamentos são recusadas.`}
      >
        <div className={signupFrame.passwordField}>
          <Input
            id="password"
            name="password"
            type={showPw ? 'text' : 'password'}
            required
            autoComplete="new-password"
            autoFocus
            disabled={pending}
            aria-invalid={error ? true : undefined}
            onChange={() => setClientError(null)}
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
      </Field>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <div className={loginFrame.submit}>
        <Button type="submit" loading={pending} className={signupFrame.buttonFull}>
          Atualizar senha
        </Button>
      </div>
    </form>
  );
}
