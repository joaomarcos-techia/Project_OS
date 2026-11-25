import type { Metadata } from 'next';
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
 *
 * Visual: a mesma moldura do login (`LoginFrame`), para quem chega pelo e-mail
 * reconhecer onde está. A tela não diz se a conta existe: sem grant, a mensagem
 * é a mesma para qualquer link.
 */
import { ArrowLeft } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LoginFrame, LoginIntro, loginFrame } from '@/components/shared/login-frame';
import { signupFrame } from '@/components/shared/signup-frame';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { RECOVERY_GRANT_COOKIE, readRecoveryGrant } from '@/lib/auth/recovery-grant';
import { createServerClient } from '@/lib/auth/supabase-server';

import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Nova senha' };

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

  // O e-mail só alimenta o campo oculto de usuário do formulário: sem ele, o
  // gerenciador de senhas não sabe de que conta é a senha nova, não atualiza a
  // salva e, no login seguinte, preenche a ANTIGA. Não decide nada: quem mostra
  // o formulário continua sendo o grant.
  //
  // Ciclo 9: o grant só abre o formulário junto da sessão que o próprio link abriu, a mesma regra
  // da action. Depois da troca, o logout global revoga essa sessão; os cookies capturados antes
  // continuavam com o grant assinado e a tela dizia "Ela vale a partir de agora" para um link já
  // usado (o envio já era recusado). Agora a tela diz que o link não vale mais.
  let username: string | null = null;
  let live = false;
  if (grant) {
    const supabase = await createServerClient();
    const { data } = await supabase.auth.getUser();
    live = data.user?.id === grant.userId;
    if (live && data.user?.email) username = data.user.email;
  }

  return (
    <LoginFrame>
      <div className={loginFrame.view}>
        <LoginIntro
          title="Nova senha"
          lead={
            live
              ? 'Crie a senha que você vai usar para entrar na Qoro. Ela vale a partir de agora.'
              : 'Para criar uma senha nova, use um link de redefinição recente.'
          }
        />
        {live ? (
          <ResetPasswordForm username={username} />
        ) : (
          <div className={loginFrame.form}>
            <Alert variant="danger" title="Link inválido ou expirado">
              Ele já foi usado ou venceu. Volte ao login e solicite um novo link em “Esqueci a
              senha”.
            </Alert>
            <div className={signupFrame.actions}>
              <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
                <ArrowLeft aria-hidden="true" className="size-4" />
                Voltar para o login
              </Link>
            </div>
          </div>
        )}
      </div>
    </LoginFrame>
  );
}
