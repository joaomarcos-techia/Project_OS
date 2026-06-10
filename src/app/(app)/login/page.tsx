'use client';

import { Suspense, useActionState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-lg font-semibold tracking-[-0.02em]">
            Clinica<b className="font-bold text-primary-600">OS</b>
          </span>
          <p className="text-sm text-fg-muted">Entre para acessar sua clínica.</p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            {reason && REASONS[reason] ? (
              <Alert variant="warning">{REASONS[reason]}</Alert>
            ) : null}

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

              <Field label="Senha" htmlFor="password">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  disabled={pending}
                  placeholder="••••••••"
                />
              </Field>

              {state.error ? <Alert variant="danger">{state.error}</Alert> : null}

              <Button type="submit" loading={pending} className="w-full">
                {pending ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-fg-muted">
          <a href="/forgot-password" className="font-medium text-primary-600 hover:text-primary-700">
            Esqueci minha senha
          </a>
        </p>
      </div>
    </main>
  );
}
