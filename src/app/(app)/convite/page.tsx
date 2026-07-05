'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useActionState, useEffect, useState } from 'react';

import { Logo } from '@/components/shared/logo';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { createBrowserClient } from '@/lib/auth/supabase-browser';

import { acceptInviteAction, type AcceptState } from './actions';

const INITIAL: AcceptState = { error: null };

// useSearchParams() força CSR bailout — boundary <Suspense> obrigatório p/ prerender.
export default function ConvitePage() {
  return (
    <Suspense fallback={null}>
      <ConviteForm />
    </Suspense>
  );
}

type Meta = { clinica?: string; funcao?: string; convidado_por?: string; nome?: string };

function ConviteForm() {
  const params = useSearchParams();
  const code = params.get('code');
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    // O link do convite traz `?code=...` (PKCE) — troca por session antes do
    // updateUser (client-side; o cookie é lido pela action server-side). Depois lê
    // o user_metadata do convite (clínica/função/quem convidou) para o contexto.
    const sb = createBrowserClient();
    void (async () => {
      if (code) await sb.auth.exchangeCodeForSession(code);
      const { data } = await sb.auth.getUser();
      setMeta((data.user?.user_metadata ?? {}) as Meta);
    })();
  }, [code]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="h-7 w-auto" />
          <p className="text-sm text-fg-muted">
            {meta?.convidado_por ? `${meta.convidado_por} convidou você` : 'Você foi convidado'}
            {meta?.clinica ? ` para a equipe da ${meta.clinica}` : ''}
            {meta?.funcao ? `, como ${meta.funcao}` : ''}.
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <h1 className="text-base font-semibold">Criar senha de acesso</h1>
            <form action={formAction} className="flex flex-col gap-4">
              <Field label="Senha (mín 8 caracteres)" htmlFor="password">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={pending}
                />
              </Field>
              <Field label="Confirmar senha" htmlFor="confirm">
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={pending}
                />
              </Field>
              {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
              <Button type="submit" loading={pending} className="w-full">
                Criar senha e entrar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
