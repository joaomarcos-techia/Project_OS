'use client';

import { Suspense, useActionState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-4 text-xl font-semibold">Nova senha</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Nova senha (mín 8 caracteres)</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            disabled={pending}
            className="rounded border border-gray-300 px-3 py-2"
          />
        </label>
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
          {pending ? 'Atualizando…' : 'Atualizar senha'}
        </button>
      </form>
    </main>
  );
}
