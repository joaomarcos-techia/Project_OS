'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import { verifyMfaAction, type MfaActionState } from './actions';

const INITIAL: MfaActionState = { error: null };

export default function MfaPage() {
  const [state, formAction, pending] = useActionState(verifyMfaAction, INITIAL);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-lg font-semibold tracking-[-0.02em]">
            Clinica<b className="font-bold text-primary-600">OS</b>
          </span>
          <p className="text-sm text-fg-muted">Verificação em duas etapas.</p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <div>
              <h1 className="text-base font-semibold">Código TOTP</h1>
              <p className="mt-1 text-sm text-fg-muted">
                Abra seu app autenticador (Authy / Google Authenticator) e digite o código de 6
                dígitos.
              </p>
            </div>
            <form action={formAction} className="flex flex-col gap-4">
              <Input
                name="code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                disabled={pending}
                aria-label="Código de 6 dígitos"
                className="text-center text-lg tracking-[0.4em]"
              />
              {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
              <Button type="submit" loading={pending} className="w-full">
                Verificar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
