'use server';

import { readTissFootprintLazy } from '@/app/(app)/_lib/tiss-footprint';
import {
  recordTissPasswordChange,
  tissPasswordReuseError,
} from '@/lib/auth/security-profile/password-lifecycle';
import { tissPasswordPolicyError } from '@/lib/auth/security-profile/password-policy';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  advanceSignupCredentialEpoch,
  checkSignupPasswordExposure,
  finishSignupCredentialEpoch,
  markSignupPasswordSet,
  readSignupPasswordState,
} from '@/contexts/onboarding';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertPasswordResetCompletionAllowed, getClientIp } from '@/lib/auth/rate-limit';
import {
  isOrphanRecoveryEpochConsumed,
  markOrphanRecoveryEpochConsumed,
} from '@/lib/auth/recovery-consumption';
import {
  RECOVERY_GRANT_COOKIE,
  readRecoveryGrant,
  recoveryGrantCookieOptions,
  signRecoveryGrant,
} from '@/lib/auth/recovery-grant';
import { bumpSessionEpochIfCurrent, withOrphanRecoveryLock } from '@/lib/auth/session-epoch';
import { signupPasswordMessage, signupPasswordSchema } from '@/lib/auth/signup-password';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { logger } from '@/lib/observability/logger';

const Schema = z.object({ password: signupPasswordSchema });

export type ResetState = { error: string | null };

const INVALID_GRANT =
  'Link de redefinição inválido, expirado ou já utilizado. Peça um novo ao administrador.';
const PWNED_PASSWORD = 'Escolha uma senha que não apareceu em vazamentos conhecidos.';
const EXPOSURE_UNAVAILABLE = 'Não foi possível validar a senha agora. Tente novamente.';
const SAME_PASSWORD = 'A nova senha precisa ser diferente da senha atual.';

/**
 * Recusas do Auth que dizem respeito à SENHA escolhida, não ao link. Nelas o
 * Auth não gravou nada, e a pessoa só precisa escolher outra senha.
 */
function passwordRejection(error: { code?: string | undefined }): string | null {
  if (error.code === 'weak_password') return PWNED_PASSWORD;
  if (error.code === 'same_password') return SAME_PASSWORD;
  return null;
}

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const rawPassword = formData.get('password');
  const parsed = Schema.safeParse({ password: rawPassword });
  if (!parsed.success) {
    // A mensagem diz o que falta (maiúscula, número...). Antes era sempre
    // "ao menos 8 caracteres", mesmo com 12 caracteres sem número.
    return {
      error:
        signupPasswordMessage(typeof rawPassword === 'string' ? rawPassword : '') ??
        'Senha inválida.',
    };
  }

  const supabase = await createServerClient({ cookieWrites: 'required' });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  const email = user?.email;
  const userId = user?.id;
  if (!user || !email || !userId) return { error: INVALID_GRANT };

  const jar = await cookies();
  const grant = readRecoveryGrant(jar.get(RECOVERY_GRANT_COOKIE)?.value);
  if (!grant || grant.userId !== userId) {
    logger.warn('reset_password.grant_missing', { hasGrant: grant !== null });
    return { error: INVALID_GRANT };
  }

  const profile = await readAuthoritativeProfile(userId);
  if (
    (grant.kind === 'profile' && (!profile || profile.claimsVersion !== grant.epoch)) ||
    (grant.kind !== 'profile' && profile !== null)
  ) {
    logger.warn('reset_password.grant_stale', { kind: grant.kind });
    return { error: INVALID_GRANT };
  }

  // S3 (requisito 67 da ANS): com perfil, vale a regra TISS da clínica; sem perfil (pré-clínica), só no modo
  // plataforma. Antes de consumir o link: a pessoa só precisa escolher outra senha.
  const tissPasswordError = await tissPasswordPolicyError(
    parsed.data.password,
    grant.kind === 'profile' ? (profile?.clinicId ?? null) : null,
    readTissFootprintLazy,
  );
  if (tissPasswordError) return { error: tissPasswordError };
  // S4 (requisito 82): não repetir as 10 últimas, antes de consumir o link.
  const tissClinicId = grant.kind === 'profile' ? (profile?.clinicId ?? null) : null;
  const tissReuseError = await tissPasswordReuseError(userId, tissClinicId, parsed.data.password, {
    readFootprint: readTissFootprintLazy,
  });
  if (tissReuseError) return { error: tissReuseError };

  const limit = await assertPasswordResetCompletionAllowed(
    getClientIp(await headers()),
    hashEmail(email),
  );
  if (!limit.ok) {
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
  }

  if (grant.kind === 'profile') {
    // O Auth recusa senha vazada (HIBP ligado em produção), mas só DEPOIS do CAS
    // abaixo, que consome o link. Sem esta checagem a pessoa via "link inválido",
    // pedia outro, escolhia a mesma senha e caía no mesmo lugar para sempre
    // (29/09/2026). Os ramos pretenant já checavam antes; o de profile, não.
    const exposure = await checkSignupPasswordExposure(parsed.data.password);
    if (exposure === 'pwned') return { error: PWNED_PASSWORD };
    if (exposure === 'unavailable') return { error: EXPOSURE_UNAVAILABLE };

    let consumed = false;
    try {
      // CAS antes do Auth I/O: só uma requisição que carrega este epoch pode
      // instalar a senha e as sessões antigas já ficam revogadas.
      consumed = await bumpSessionEpochIfCurrent(userId, grant.epoch, 'password_reset');
    } catch (error) {
      logger.error('reset_password.epoch_bump_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return { error: 'Não foi possível redefinir a senha agora. Tente novamente.' };
    }
    if (!consumed) {
      jar.delete(RECOVERY_GRANT_COOKIE);
      logger.warn('reset_password.grant_stale', { kind: grant.kind });
      return { error: INVALID_GRANT };
    }
    jar.delete(RECOVERY_GRANT_COOKIE);

    const update = await supabase.auth.updateUser({ password: parsed.data.password });
    let error = update.error;
    if (error?.code === 'insufficient_aal') {
      // Recovery comprova posse do e-mail, mas uma conta com TOTP recebe do
      // GoTrue uma sessão aal1. `updateUser` exige aal2 e tornava impossível
      // redefinir a senha justamente quando o segundo fator não está disponível.
      // Neste ponto a prova one-time, o userId e o epoch já foram validados e o
      // CAS acima já revogou sessões antigas; a Admin API só conclui essa mesma
      // operação para a identidade comprovada.
      const adminUpdate = await createAdminClient().auth.admin.updateUserById(userId, {
        password: parsed.data.password,
      });
      error = adminUpdate.error;
      if (!error) logger.warn('reset_password.insufficient_aal_recovered', { kind: grant.kind });
    }
    if (error) {
      const rejection = passwordRejection(error);
      const remainingSeconds = Math.floor((grant.expiresAt - Date.now()) / 1000);
      if (rejection && remainingSeconds > 0) {
        // A senha foi recusada, o link não. O CAS já consumiu o epoch N; a única
        // prova que volta a valer é a do epoch N+1, com o MESMO prazo. Continua
        // de uso único e sem estender a janela.
        jar.set(
          RECOVERY_GRANT_COOKIE,
          signRecoveryGrant({
            kind: 'profile',
            userId,
            epoch: grant.epoch + 1,
            expiresAt: grant.expiresAt,
          }),
          recoveryGrantCookieOptions(remainingSeconds),
        );
        logger.warn('reset_password.password_rejected', { kind: grant.kind, code: error.code });
        return { error: rejection };
      }
      logger.warn('reset_password.update_failed', { kind: grant.kind });
      await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
      await clearSupabaseSessionSelector();
      return { error: 'Não foi possível redefinir a senha. Solicite um novo link.' };
    }

    // S4 (requisitos 81 e 82): registra a troca (best-effort; a senha já está no Auth).
    await recordTissPasswordChange(userId, tissClinicId, parsed.data.password, {
      readFootprint: readTissFootprintLazy,
    });
    await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
    await clearSupabaseSessionSelector();
    redirect('/login?reason=password_updated');
  }

  if (grant.kind === 'pretenant_orphan') {
    const exposure = await checkSignupPasswordExposure(parsed.data.password);
    if (exposure === 'pwned') {
      return { error: PWNED_PASSWORD };
    }
    if (exposure === 'unavailable') {
      return { error: EXPOSURE_UNAVAILABLE };
    }

    jar.delete(RECOVERY_GRANT_COOKIE);
    const result = await withOrphanRecoveryLock(userId, async () => {
      const admin = createAdminClient();
      const { data: authoritative, error: readError } = await admin.auth.admin.getUserById(userId);
      const authUser = authoritative.user;
      const authEpoch = Date.parse(authUser?.updated_at ?? '');
      if (
        readError ||
        !authUser ||
        authUser.id !== userId ||
        authUser.email?.trim().toLowerCase() !== email.trim().toLowerCase() ||
        !authUser.email_confirmed_at ||
        !Number.isFinite(authEpoch) ||
        authEpoch !== grant.epoch ||
        isOrphanRecoveryEpochConsumed(authUser.app_metadata, grant.epoch) ||
        readSignupPasswordState(authUser, grant.signupRef) !== 'set'
      ) {
        return { ok: false as const, reason: 'stale' as const };
      }

      const appMetadata = markOrphanRecoveryEpochConsumed(
        markSignupPasswordSet(authUser, grant.signupRef),
        grant.epoch,
      );
      const { data: updated, error } = await admin.auth.admin.updateUserById(userId, {
        password: parsed.data.password,
        app_metadata: appMetadata,
      });
      if (
        error ||
        readSignupPasswordState(updated.user, grant.signupRef) !== 'set' ||
        !isOrphanRecoveryEpochConsumed(updated.user?.app_metadata, grant.epoch)
      ) {
        return { ok: false as const, reason: 'update_failed' as const };
      }
      return { ok: true as const };
    });

    if (!result.ok && result.reason === 'stale') {
      logger.warn('reset_password.grant_stale', { kind: grant.kind });
      return { error: INVALID_GRANT };
    }
    if (!result.ok) {
      logger.warn('reset_password.update_failed', { kind: grant.kind });
      return { error: 'Não foi possível redefinir a senha. Solicite um novo link.' };
    }

    await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
    await clearSupabaseSessionSelector();
    redirect('/login?reason=password_updated');
  }

  if (grant.kind === 'pretenant') {
    const passwordState = readSignupPasswordState(user, grant.signupRef);
    if (passwordState === null) {
      logger.warn('reset_password.grant_stale', { kind: grant.kind });
      return { error: INVALID_GRANT };
    }

    // Recovery sempre escolhe uma senha nova, inclusive quando a conta já
    // tinha marker `set`; por isso a checagem HIBP não pode ser pulada nesse
    // ramo. Só o retry de continuação com a MESMA senha evita uma nova consulta.
    const exposure = await checkSignupPasswordExposure(parsed.data.password);
    if (exposure === 'pwned') {
      return { error: PWNED_PASSWORD };
    }
    if (exposure === 'unavailable') {
      return { error: EXPOSURE_UNAVAILABLE };
    }

    let expectedRowVersion = grant.epoch;
    if (passwordState === 'set') {
      // Uma atualização Auth pode ter sido confirmada enquanto a finalização
      // no banco falhou. O marker autoritativo permite fechar essa reserva antes
      // de a nova prova de recovery disputar outro epoch.
      const repaired = await finishSignupCredentialEpoch({
        userId,
        signupRef: grant.signupRef,
        expectedRowVersion,
        outcome: 'completed',
      });
      if (!repaired.ok) {
        jar.delete(RECOVERY_GRANT_COOKIE);
        logger.warn('reset_password.grant_stale', { kind: grant.kind });
        return { error: INVALID_GRANT };
      }
      expectedRowVersion = repaired.rowVersion;
    }

    // Este CAS é o mesmo usado pelo handoff. O grant deixa de valer antes de
    // qualquer I/O externo; somente o vencedor pode instalar a credencial.
    const consumed = await advanceSignupCredentialEpoch({
      userId,
      signupRef: grant.signupRef,
      expectedRowVersion,
      source: 'recovery',
    });
    if (!consumed.ok) {
      jar.delete(RECOVERY_GRANT_COOKIE);
      logger.warn('reset_password.grant_stale', { kind: grant.kind });
      return { error: INVALID_GRANT };
    }
    jar.delete(RECOVERY_GRANT_COOKIE);

    const admin = createAdminClient();
    const { data: updated, error } = await admin.auth.admin.updateUserById(userId, {
      password: parsed.data.password,
      app_metadata: markSignupPasswordSet(user, grant.signupRef),
    });
    if (error || readSignupPasswordState(updated.user, grant.signupRef) !== 'set') {
      await finishSignupCredentialEpoch({
        userId,
        signupRef: grant.signupRef,
        expectedRowVersion: consumed.rowVersion,
        outcome: 'uncertain',
      }).catch(() => undefined);
      logger.warn('reset_password.update_failed', { kind: grant.kind });
      return { error: 'Não foi possível redefinir a senha. Solicite um novo link.' };
    }

    const finished = await finishSignupCredentialEpoch({
      userId,
      signupRef: grant.signupRef,
      expectedRowVersion: consumed.rowVersion,
      outcome: 'completed',
    });
    if (!finished.ok) {
      logger.warn('reset_password.finish_failed', { kind: grant.kind });
      return { error: 'Não foi possível concluir a redefinição. Solicite um novo link.' };
    }

    await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
    await clearSupabaseSessionSelector();
    redirect('/login?reason=password_updated');
  }

  return { error: INVALID_GRANT };
}
