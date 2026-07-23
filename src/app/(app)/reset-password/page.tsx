'use client';

import { Suspense, useActionState, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
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

/**
 * Fases da recovery session:
 *   checking — estabelecendo a sessão a partir do link (assíncrono);
 *   ready    — sessão de recovery válida; libera o form;
 *   invalid  — link expirado/inválido/já usado, ou sem sessão.
 */
type Phase = 'checking' | 'ready' | 'invalid';

function ResetPasswordForm() {
  const params = useSearchParams();
  const [phase, setPhase] = useState<Phase>('checking');
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL);

  useEffect(() => {
    // O reset agora é iniciado por um ADMIN (o link é enviado pelo Supabase, não
    // pelo próprio usuário). Por isso NÃO dá para assumir PKCE: o `?code` exige
    // um code-verifier que só existe no navegador que INICIOU o fluxo — e aqui
    // o fluxo foi iniciado no painel do Supabase, não neste navegador.
    //
    // Ordem de tentativa, do mais robusto ao legado:
    //   1. token_hash + type   → verifyOtp (recomendado; funciona em qualquer navegador)
    //   2. hash implícito (#access_token…) → o client @supabase/ssr detecta e
    //      grava a sessão em cookie sozinho; conferimos via getSession()
    //   3. ?code (PKCE)        → só funciona se o mesmo navegador iniciou (legado)
    const sb = createBrowserClient();
    let active = true;
    const done = (ok: boolean) => {
      if (active) setPhase(ok ? 'ready' : 'invalid');
    };

    void (async () => {
      const tokenHash = params.get('token_hash');
      const type = params.get('type');
      if (tokenHash && type === 'recovery') {
        const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        return done(!error);
      }

      const code = params.get('code');
      if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        return done(!error);
      }

      // Sem token_hash nem code: ou veio no hash (auto-detectado pela init do
      // client @supabase/ssr) ou o link é inválido. getUser() valida a sessão
      // contra o servidor (ADR-008 — não confiar no cookie sem verificar).
      const { data } = await sb.auth.getUser();
      return done(Boolean(data.user));
    })();

    return () => {
      active = false;
    };
  }, [params]);

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

            {phase === 'checking' ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <Spinner className="size-4" /> Validando o link…
              </div>
            ) : phase === 'invalid' ? (
              <Alert variant="danger" title="Link inválido ou expirado">
                Peça um novo link de redefinição ao administrador da clínica.
              </Alert>
            ) : (
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
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
