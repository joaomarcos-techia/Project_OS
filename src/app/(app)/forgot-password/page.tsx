'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { forgotPasswordAction, type ForgotState } from './actions';

const INITIAL: ForgotState = { error: null, sent: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-lg font-semibold tracking-[-0.02em]">
            Clinica<b className="font-bold text-primary-600">OS</b>
          </span>
          <p className="text-sm text-fg-muted">Recupere o acesso à sua conta.</p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <h1 className="text-base font-semibold">Esqueci minha senha</h1>
            {state.sent ? (
              <Alert variant="success">
                Se o email existir, enviamos instruções de recuperação. Verifique sua caixa de
                entrada.
              </Alert>
            ) : (
              <form action={formAction} className="flex flex-col gap-4">
                <Field label="Email" htmlFor="email">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    disabled={pending}
                    placeholder="voce@clinica.com.br"
                  />
                </Field>
                {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
                <Button type="submit" loading={pending} className="w-full">
                  Enviar instruções
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-fg-muted">
          <a href="/login" className="font-medium text-primary-600 hover:text-primary-700">
            Voltar para login
          </a>
        </p>
      </div>
    </main>
  );
}
