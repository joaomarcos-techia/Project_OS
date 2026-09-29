'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useActionState, useState } from 'react';

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
  const [showPw, setShowPw] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        label="Nova senha (mín 8 caracteres)"
        htmlFor="password"
        hint="Senhas comuns ou que já apareceram em vazamentos são recusadas."
      >
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPw ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            disabled={pending}
            placeholder="••••••••"
            className="pr-11"
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
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      <Button type="submit" loading={pending} className="w-full">
        Atualizar senha
      </Button>
    </form>
  );
}
