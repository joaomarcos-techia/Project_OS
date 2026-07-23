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
type Phase = 'checking' | 'ready' | 'invalid';

function ConviteForm() {
  const params = useSearchParams();
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [pw, setPw] = useState('');

  useEffect(() => {
    // Caminho OFICIAL: o link chega já autenticado por `/auth/confirm` (verifyOtp
    // server-side) — aqui só confirmamos a sessão. FALLBACK legado (removível
    // quando os templates migrarem): `token_hash` → verifyOtp, hash implícito
    // (auto-detect), `?code` (PKCE — só funciona no mesmo navegador que iniciou).
    const sb = createBrowserClient();
    let active = true;
    void (async () => {
      const tokenHash = params.get('token_hash');
      const type = params.get('type');
      if (tokenHash && type === 'invite') {
        await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' }).catch(() => {});
      } else {
        const code = params.get('code');
        if (code) await sb.auth.exchangeCodeForSession(code).catch(() => {});
      }
      // getUser() valida a sessão contra o servidor (ADR-008 — não confiar no cookie).
      const { data } = await sb.auth.getUser();
      if (!active) return;
      if (data.user) {
        setMeta((data.user.user_metadata ?? {}) as Meta);
        setPhase('ready');
      } else {
        setPhase('invalid');
      }
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
          <p className="text-sm text-fg-muted">
            {meta?.convidado_por ? `${meta.convidado_por} convidou você` : 'Você foi convidado'}
            {meta?.clinica ? ` para a equipe da ${meta.clinica}` : ''}
            {meta?.funcao ? `, como ${meta.funcao}` : ''}.
          </p>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-4">
            <h1 className="text-base font-semibold">Criar senha de acesso</h1>
            {phase === 'checking' ? (
              <p className="text-sm text-fg-muted">Validando o convite…</p>
            ) : phase === 'invalid' ? (
              <Alert variant="danger" title="Convite inválido ou expirado">
                Abra o link do convite novamente ou peça um novo ao administrador da clínica.
              </Alert>
            ) : (
              <form action={formAction} className="flex flex-col gap-4">
              <Field label="Senha" htmlFor="password">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={pending}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  aria-describedby="pw-reqs"
                />
              </Field>
              <ul id="pw-reqs" className="-mt-1 flex flex-col gap-0.5 text-(length:--fs-xs)">
                {[
                  ['Mínimo de 8 caracteres', pw.length >= 8],
                  ['Ao menos uma letra', /[a-zA-Z]/.test(pw)],
                  ['Ao menos um número', /\d/.test(pw)],
                  ['Ao menos um símbolo', /[^a-zA-Z0-9]/.test(pw)],
                ].map(([label, ok]) => (
                  <li key={label as string} className={ok ? 'text-success-600' : 'text-fg-subtle'}>
                    {ok ? '✓' : '○'} {label}
                  </li>
                ))}
              </ul>
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
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
