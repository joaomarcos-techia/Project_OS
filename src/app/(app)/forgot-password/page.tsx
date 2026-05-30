'use client';

import { useActionState } from 'react';

import { forgotPasswordAction, type ForgotState } from './actions';

const INITIAL: ForgotState = { error: null, sent: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, INITIAL);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-4 text-xl font-semibold">Esqueci minha senha</h1>
      {state.sent ? (
        <p className="rounded border border-green-400 bg-green-50 p-3 text-sm text-green-900">
          Se o email existir, enviamos instruções de recuperação. Verifique sua caixa de entrada.
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
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
            {pending ? 'Enviando…' : 'Enviar instruções'}
          </button>
        </form>
      )}
      <p className="mt-4 text-xs text-gray-600">
        <a href="/login" className="underline">
          Voltar para login
        </a>
      </p>
    </main>
  );
}
