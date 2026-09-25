'use server';

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
import { RECOVERY_GRANT_COOKIE, readRecoveryGrant } from '@/lib/auth/recovery-grant';
import { bumpSessionEpochIfCurrent, withOrphanRecoveryLock } from '@/lib/auth/session-epoch';
import { signupPasswordSchema } from '@/lib/auth/signup-password';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { logger } from '@/lib/observability/logger';

const Schema = z.object({ password: signupPasswordSchema });

export type ResetState = { error: string | null };

const INVALID_GRANT =
  'Link de redefinição inválido, expirado ou já utilizado. Peça um novo ao administrador.';

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = Schema.safeParse({ password: formData.get('password') });
  if (!parsed.success) return { error: 'Senha deve ter ao menos 8 caracteres.' };

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

  const limit = await assertPasswordResetCompletionAllowed(
    getClientIp(await headers()),
    hashEmail(email),
  );
  if (!limit.ok) {
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
  }

  if (grant.kind === 'profile') {
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

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      logger.warn('reset_password.update_failed', { kind: grant.kind });
      await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
      await clearSupabaseSessionSelector();
      return { error: 'Não foi possível redefinir a senha. Solicite um novo link.' };
    }

    await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
    await clearSupabaseSessionSelector();
    redirect('/login?reason=password_updated');
  }

  if (grant.kind === 'pretenant_orphan') {
    const exposure = await checkSignupPasswordExposure(parsed.data.password);
    if (exposure === 'pwned') {
      return { error: 'Escolha uma senha que não apareceu em vazamentos conhecidos.' };
    }
    if (exposure === 'unavailable') {
      return { error: 'Não foi possível validar a senha agora. Tente novamente.' };
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
      return { error: 'Escolha uma senha que não apareceu em vazamentos conhecidos.' };
    }
    if (exposure === 'unavailable') {
      return { error: 'Não foi possível validar a senha agora. Tente novamente.' };
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
