'use client';

import { useActionState } from 'react';

import { verifyMfaAction, type MfaActionState } from './actions';

const INITIAL: MfaActionState = { error: null };

export default function MfaPage() {
  const [state, formAction, pending] = useActionState(verifyMfaAction, INITIAL);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-4 text-xl font-semibold">Código TOTP</h1>
      <p className="mb-4 text-sm text-gray-600">
        Abra seu app autenticador (Authy / Google Authenticator) e digite o código de 6
        dígitos.
      </p>
      <form action={formAction} className="flex flex-col gap-3">
        <input
          name="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-2 text-center text-lg tracking-widest"
        />
        {state.error ? (
          <p className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Verificando…' : 'Verificar'}
        </button>
      </form>
    </main>
  );
}
