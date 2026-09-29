'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { resetPasswordAction, type ResetState } from './actions';

const INITIAL: ResetState = { error: null };

/**
 * Só o formulário. A decisão de mostrá-lo é do Server Component (AUTH-006):
 * este componente não valida token nem estabelece sessão — se ele renderizou,
 * o grant de recovery já foi verificado no servidor.
 */
export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        label="Nova senha (mín 8 caracteres)"
        htmlFor="password"
        hint="Senhas comuns ou que já apareceram em vazamentos são recusadas."
      >
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          disabled={pending}
          placeholder="••••••••"
        />
      </Field>
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      <Button type="submit" loading={pending} className="w-full">
        Atualizar senha
      </Button>
    </form>
  );
}
