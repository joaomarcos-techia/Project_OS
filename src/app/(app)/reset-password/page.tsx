'use client';

import { Suspense, useActionState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { createBrowserClient } from '@/lib/auth/supabase-browser';

import { resetPasswordAction, type ResetState } from './actions';

const INITIAL: ResetState = { error: null };

// useSearchParams() força CSR bailout — precisa de um boundary <Suspense> para
// o Next prerenderizar a casca estática (erro "missing-suspense-with-csr-bailout").
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const code = params.get('code');
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL);

  useEffect(() => {
    // Supabase v2 reset link traz `?code=...` (PKCE) que precisa ser trocado por
    // session antes do updateUser. Fazemos isso client-side; o browser client
    // armazena a session em cookie, que actions.ts server-side lê.
    if (code) {
      const sb = createBrowserClient();
      void sb.auth.exchangeCodeForSession(code);
    }
  }, [code]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="h-7 w-auto" />
          <p className="text-sm text-fg-muted">Defina uma nova senha de acesso.</p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <h1 className="text-base font-semibold">Nova senha</h1>
            <form action={formAction} className="flex flex-col gap-4">
              <Field label="Nova senha (mín 8 caracteres)" htmlFor="password">
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
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
