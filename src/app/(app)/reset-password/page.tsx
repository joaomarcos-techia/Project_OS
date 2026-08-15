/**
 * `/reset-password` — destino do link de recovery.
 *
 * ===================================================================
 * AUTH-006 — por que esta página deixou de resolver o token no cliente
 * ===================================================================
 * A versão anterior era um Client Component que tentava, em ordem,
 * `verifyOtp(token_hash)`, `exchangeCodeForSession(?code)` e, por último,
 * `getUser()`. Esse último ramo é o achado: QUALQUER sessão válida — inclusive
 * uma autenticada por senha — chegava a `ready` e o formulário aparecia.
 *
 * Agora a prova de recovery é server-side e única: `/auth/confirm` faz o
 * `verifyOtp(type:'recovery')` e emite o grant one-time. Esta página só
 * pergunta se o grant existe. Ela não estabelece sessão, não decide nada e não
 * pode ser convencida por um cookie de login comum.
 *
 * O ramo `?code` (PKCE) foi removido de propósito: ele exige um code-verifier
 * que só existe no navegador que INICIOU o fluxo, e o reset aqui é iniciado
 * pelo administrador — nunca por este navegador. Além disso, um `code` trocado
 * com sucesso não prova que o fluxo era de RECOVERY, e é exatamente essa prova
 * que o grant precisa carregar. Links legados caem no estado "peça um novo".
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { RECOVERY_GRANT_COOKIE, readRecoveryGrant } from '@/lib/auth/recovery-grant';

import { ResetPasswordForm } from './reset-password-form';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;

  // Alguém abriu o link direto aqui em vez de `/auth/confirm` (template antigo,
  // encaminhamento manual). Manda para o único lugar que sabe verificar o
  // token — e que, ao verificar, emite o grant.
  const jar = await cookies();
  const grant = readRecoveryGrant(jar.get(RECOVERY_GRANT_COOKIE)?.value);
  if (!grant && tokenHash && type === 'recovery') {
    redirect(
      `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery&next=%2Freset-password`,
    );
  }

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
            {grant ? (
              <ResetPasswordForm />
            ) : (
              <Alert variant="danger" title="Link inválido ou expirado">
                Peça um novo link de redefinição ao administrador da clínica.
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
