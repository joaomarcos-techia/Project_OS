'use client';

import { ChevronDown } from 'lucide-react';
import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { forgotPasswordAction, type ForgotPasswordActionState } from './actions';

const INITIAL: ForgotPasswordActionState = { error: null, sent: false };

/** Recuperação inline: mantém o Login como rota pública única e evita link sem grant. */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL);

  return (
    <details className="group mt-2 rounded-(--r-md) border border-border bg-surface-2 open:shadow-xs">
      <summary className="flex min-h-(--hit-target) cursor-pointer list-none items-center justify-between gap-3 rounded-(--r-md) px-3 text-(length:--fs-sm) font-medium text-fg-muted transition-[background-color,color] hover:bg-surface-hover hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        Esqueci minha senha
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-(--dur-fast) group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-border px-3 py-4">
        <p className="text-pretty text-(length:--fs-sm) text-fg-muted">
          Informe seu e-mail. Se houver uma conta, enviaremos um link seguro de redefinição.
        </p>
        <form action={formAction} className="mt-4 flex flex-col gap-3">
          <Field label="E-mail" htmlFor="recovery-email">
            <Input
              id="recovery-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={pending || state.sent}
              placeholder="voce@clinica.com.br"
            />
          </Field>
          {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
          {state.sent ? (
            <Alert variant="success" title="Verifique seu e-mail">
              Se houver uma conta para esse endereço, o link será enviado.
            </Alert>
          ) : (
            <Button type="submit" variant="secondary" loading={pending} className="w-full">
              Enviar link seguro
            </Button>
          )}
        </form>
      </div>
    </details>
  );
}
