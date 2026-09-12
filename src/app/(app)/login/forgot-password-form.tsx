'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { forgotPasswordAction, type ForgotPasswordActionState } from './actions';

const INITIAL: ForgotPasswordActionState = { error: null, sent: false };

/**
 * Recuperação inline: mantém o Login como rota pública única e evita link sem grant.
 *
 * O gatilho tem a aparência do link "Esqueci a senha" do design, mas continua
 * sendo um `<details>` nativo — abre sem JS e o painel nasce logo abaixo. Por
 * isso este componente fica FORA do `<form>` de login (form aninhado é HTML
 * inválido); quem coloca o gatilho acima do botão Entrar é a ordem de flex da
 * página, não a ordem do DOM.
 */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL);

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-end pt-0.5 [&::-webkit-details-marker]:hidden">
        <span className="rounded-(--r-sm) px-1 py-1 text-[13px] font-medium leading-none text-(--text-link) transition-colors group-hover:text-(--primary-800) group-focus-visible:shadow-(--focus-ring) group-focus-visible:outline-none">
          Esqueci a senha
        </span>
      </summary>

      <div className="mt-3 rounded-(--r-md) border border-border bg-surface-2 px-3 py-4">
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
