import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  PublicBlock,
  PublicHeading,
  PublicPage,
  SignupStage,
  signupFrame,
} from '@/components/shared/signup-frame';
import { buttonVariants } from '@/components/ui/button';
import {
  ensureSignupDraftForVerifiedEmail,
  ensureVerifiedSignupAuthBinding,
  readOwnedSignupReference,
  resolveReadyOwnedSignupOnboarding,
  resolveSignupContinuation,
  validateVerifiedSignupAuthUserForClaim,
  readConsumedSignupRecovery,
  SIGNUP_RECOVERY_COOKIE,
} from '@/contexts/onboarding';

import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
import {
  readSignupConfirmationGrant,
  SIGNUP_CONFIRMATION_GRANT_COOKIE,
} from '@/lib/auth/signup-confirmation-grant';

import styles from '../cadastro.module.css';
import { SignupPasswordForm } from './signup-password-form';

export const dynamic = 'force-dynamic';

function TemporarilyUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <PublicPage>
      <SignupStage step={2}>
        <PublicHeading
          title="Não foi possível verificar agora"
          lead="Tente verificar a confirmação novamente em instantes."
        />
        <PublicBlock narrow>
          <a
            href={retryHref}
            className={buttonVariants({ variant: 'subtle', className: signupFrame.buttonFull })}
          >
            Tentar novamente
          </a>
        </PublicBlock>
      </SignupStage>
    </PublicPage>
  );
}

/**
 * Confirmação autoritativa e continuação pelo aparelho que recebeu o link.
 *
 * O destino anterior era `/cadastro/continuar`, uma revisão de formulário.
 * O destinatário pode continuar neste aparelho com a sessão verificada pelo OTP. A nova UI
 * já recolheu a senha antes do código e segue automaticamente. Esta página só pede uma senha
 * quando a identidade legada ou recuperada ainda não tem credencial confiável concluída.
 *
 * A checagem abaixo é o que impede a tela de MENTIR. Sem sessão verificada,
 * "E-mail confirmado" seria só um texto numa URL que qualquer um abre. Quem já
 * tem clínica (`redirect`) vai para o destino real em vez de ver uma tela de
 * cadastro que não lhe diz respeito.
 */
export default async function CadastroConfirmadoPage() {
  const retryHref = '/cadastro/confirmado';
  const onboarding = await resolvePreTenantOnboarding();
  if (!onboarding.ok) {
    if (onboarding.reason === 'unavailable') {
      return <TemporarilyUnavailable retryHref={retryHref} />;
    }
    redirect('/login');
  }
  if (onboarding.kind === 'redirect') redirect(onboarding.route);
  const jar = await cookies();
  const repairGrant = readSignupConfirmationGrant(jar.get(SIGNUP_CONFIRMATION_GRANT_COOKIE)?.value);
  const repairSignupRef = repairGrant?.userId === onboarding.userId ? repairGrant.signupRef : null;
  const recoveryProof = readSignupConfirmationGrant(jar.get(SIGNUP_RECOVERY_COOKIE)?.value);
  const recovery =
    recoveryProof?.userId === onboarding.userId && recoveryProof.signupRef === onboarding.signupRef
      ? await readConsumedSignupRecovery(onboarding.userId, recoveryProof.signupRef)
      : null;
  const owned = await readOwnedSignupReference(onboarding.userId, onboarding.email);
  if (!owned.ok && owned.reason === 'unavailable') {
    return <TemporarilyUnavailable retryHref={retryHref} />;
  }

  // O grant existe somente depois que este callback consumiu e validou o OTP.
  // Se o Auth ainda aponta para uma tentativa anterior, a prova mais recente
  // precisa vencer no retry; depois do claim, a referencia possuida no banco
  // continua sendo a autoridade principal.
  const recoveredWithoutDraft = !owned.ok && owned.reason === 'gone' && recovery !== null;
  if (recoveredWithoutDraft && onboarding.pendingSignupRef === null) {
    const continuation = await resolveSignupContinuation();
    if (continuation.ok) redirect(continuation.next);
  }
  const signupRef = owned.ok
    ? owned.signupRef
    : recoveryProof?.userId === onboarding.userId
      ? recoveryProof.signupRef
      : (repairSignupRef ?? onboarding.pendingSignupRef);
  if (!owned.ok && signupRef && !recoveredWithoutDraft) {
    const validation = await validateVerifiedSignupAuthUserForClaim({
      userId: onboarding.userId,
      email: onboarding.email,
    });
    if (!validation.ok) {
      if (validation.reason === 'obfuscated') redirect('/auth/auth-error?reason=invalid_token');
      return <TemporarilyUnavailable retryHref={retryHref} />;
    }
    const claimed = await ensureSignupDraftForVerifiedEmail(
      onboarding.userId,
      onboarding.email,
      signupRef,
    );
    if (!claimed.ok) {
      if (claimed.reason === 'gone') redirect('/auth/auth-error?reason=invalid_token');
      return <TemporarilyUnavailable retryHref={retryHref} />;
    }
  }
  if (!signupRef) redirect('/auth/auth-error?reason=invalid_token');

  // O banco vence quando o claim já aconteceu. Assim, se a Admin API falhou
  // depois do commit SQL, uma nova carga reata o marker à referência realmente
  // possuída em vez de insistir na referência antiga do Auth.
  const binding = recoveredWithoutDraft
    ? { ok: true as const }
    : await ensureVerifiedSignupAuthBinding({
        userId: onboarding.userId,
        email: onboarding.email,
        signupRef,
      });
  if (!binding.ok) {
    if (binding.reason === 'obfuscated') redirect('/auth/auth-error?reason=invalid_token');
    return <TemporarilyUnavailable retryHref={retryHref} />;
  }
  const ready = await resolveReadyOwnedSignupOnboarding();
  if (ready.ok && ready.kind === 'redirect') redirect(ready.route);
  if (ready.ok) {
    const continuation = await resolveSignupContinuation();
    if (continuation.ok) redirect(continuation.next);
  }
  // Auth may have committed the password before SQL finalization lost its
  // response. Offer reconciliation with the same password after refresh too.
  const reconcile =
    !ready.ok &&
    ready.reason === 'credentials_invalid' &&
    owned.ok &&
    (owned.credentialState === 'reserved' || owned.credentialState === 'uncertain');
  if (!ready.ok && ready.reason !== 'credentials_pending' && !reconcile) {
    return <TemporarilyUnavailable retryHref={retryHref} />;
  }
  return (
    <PublicPage>
      <SignupStage step={2}>
        <div className={styles.stack} data-slot="cadastro-confirmado">
          <PublicHeading
            title="E-mail confirmado"
            lead={
              ready.ok ? 'Sua senha já está definida. Continue para escolher o plano.' : undefined
            }
          />
          <PublicBlock narrow>
            {ready.ok ? (
              <a
                href="/cadastro/plano"
                className={buttonVariants({
                  variant: 'primary',
                  className: signupFrame.buttonFull,
                })}
              >
                Escolher plano
              </a>
            ) : (
              <SignupPasswordForm reconcile={reconcile} />
            )}
          </PublicBlock>
        </div>
      </SignupStage>
    </PublicPage>
  );
}
