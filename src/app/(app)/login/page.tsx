'use client';

import { Suspense, useActionState } from 'react';
import { useSearchParams } from 'next/navigation';

import { loginAction, type LoginActionState } from './actions';

const INITIAL: LoginActionState = { error: null };

// useSearchParams() força CSR bailout — boundary <Suspense> obrigatório p/ prerender.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const REASONS: Record<string, string> = {
  drift: 'Sua sessão foi invalidada por mudança de permissões. Faça login novamente.',
  disabled: 'Seu acesso foi desativado. Contate o administrador.',
  no_profile: 'Profile não encontrado. Contate o administrador.',
};

function LoginForm() {
  const params = useSearchParams();
  const reason = params.get('reason');
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-6 text-xl font-semibold">Entrar</h1>

      {reason && REASONS[reason] ? (
        <p className="mb-4 rounded border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-900">
          {REASONS[reason]}
        </p>
      ) : null}

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
        <label className="flex flex-col gap-1 text-sm">
          <span>Senha</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
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
          {pending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>

      <p className="mt-4 text-xs text-gray-600">
        <a href="/forgot-password" className="underline">
          Esqueci minha senha
        </a>
      </p>
    </main>
  );
}
