'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useActionState, useState, type FormEvent } from 'react';

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
    <form action={formAction} onSubmit={checkPassword} className="flex flex-col gap-4">
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
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPw ? 'text' : 'password'}
            required
            autoComplete="new-password"
            disabled={pending}
            placeholder="••••••••"
            className="pr-11"
            onChange={() => setClientError(null)}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-(--field-radius) text-fg-subtle transition-colors hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          >
            {showPw ? (
              <EyeOff aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
      </Field>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Button type="submit" loading={pending} className="w-full">
        Atualizar senha
      </Button>
    </form>
  );
}
