import 'server-only';

import { randomBytes } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { z } from 'zod';

import { resolveReadyPreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';

import {
  bindLegacyVerifiedSignupAppMetadata,
  hasSignupAuthBindingMarker,
  hasUntrustedInitialSignupPassword,
  isPendingSignupUserBound,
  markPasswordAuthenticatedSignupReady,
  readPendingSignupReference,
  readSignupAuthBinding,
  rebindPendingSignupAppMetadata,
} from './signup-auth-binding';
import { readOwnedSignupReference, resumeRetainedOwnedSignupDraft } from './signup-draft';
import { readSignupDeliveryAttemptState } from './signup-session';

export type EnsureVerifiedSignupAuthBindingOutcome =
  | { ok: true }
  | { ok: false; reason: 'obfuscated' | 'unavailable' };
export type EnsureReadyOwnedSignupAuthBindingOutcome =
  | { ok: true; signupRef: string; orphanEpoch?: number }
  | { ok: false; reason: 'obfuscated' | 'unavailable' };
export type ValidateLegacySignupDeliveryCandidateOutcome =
  | { ok: true; user: User }
  | { ok: false; reason: 'obfuscated' | 'unavailable' };
export type ValidateVerifiedSignupAuthUserOutcome =
  | { ok: true; binding: 'pending' | 'legacy' }
  | { ok: false; reason: 'obfuscated' | 'unavailable' };

const inputSchema = z
  .object({
    userId: z.string().uuid(),
    email: z.string().trim().max(160).email(),
    signupRef: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const verifiedUserInputSchema = inputSchema.omit({ signupRef: true }).strict();
const legacyDeliveryInputSchema = inputSchema
  .extend({
    attemptEpoch: z.number().int().positive(),
    stage: z.enum(['initial', 'resend']),
  })
  .strict();

/**
 * Gate canônico das etapas caras do cadastro.
 *
 * O marker `set` do Auth não basta sozinho: uma adoção pode ter atualizado o
 * Auth e perdido a resposta do commit SQL. Só a mesma referência, já concluída
 * no banco, autoriza leitura do draft, plano e checkout.
 */
export async function resolveReadyOwnedSignupOnboarding(existingClient?: SupabaseClient) {
  const onboarding = await resolveReadyPreTenantOnboarding(existingClient);
  if (!onboarding.ok || onboarding.kind !== 'pretenant') return onboarding;
  if (!onboarding.signupRef) return { ok: false as const, reason: 'credentials_invalid' as const };

  const owned = await readOwnedSignupReference(onboarding.userId, onboarding.email);
  if (!owned.ok) {
    return {
      ok: false as const,
      reason:
        owned.reason === 'unavailable'
          ? ('unavailable' as const)
          : ('credentials_invalid' as const),
    };
  }
  // Um draft recriado pela própria conta verificada não repete a tentativa de
  // envio de e-mail: auth_attempt_state é NULL, mas a senha já está `set` no Auth.
  if (
    owned.signupRef !== onboarding.signupRef ||
    (owned.credentialState !== 'completed' && owned.credentialState !== null)
  ) {
    return { ok: false as const, reason: 'credentials_invalid' as const };
  }
  return { ...onboarding, signupRef: owned.signupRef };
}

/** Só a revisão do cadastro pode oferecer um novo draft após a expiração. */
export async function resolveSignupDraftEntry(existingClient?: SupabaseClient) {
  const onboarding = await resolveReadyPreTenantOnboarding(existingClient);
  if (!onboarding.ok || onboarding.kind !== 'pretenant') return onboarding;
  if (!onboarding.signupRef) return { ok: false as const, reason: 'credentials_invalid' as const };

  const owned = await readOwnedSignupReference(onboarding.userId, onboarding.email);
  if (!owned.ok) {
    if (owned.reason === 'gone') {
      return {
        ok: true as const,
        kind: 'restart' as const,
        userId: onboarding.userId,
        email: onboarding.email,
      };
    }
    return { ok: false as const, reason: 'unavailable' as const };
  }
  if (
    owned.signupRef !== onboarding.signupRef ||
    (owned.credentialState !== 'completed' && owned.credentialState !== null)
  ) {
    return { ok: false as const, reason: 'credentials_invalid' as const };
  }
  if (owned.checkoutRecovery) {
    return {
      ok: true as const,
      kind: 'redirect' as const,
      route: '/cadastro/pagamento?resultado=pending',
    };
  }
  return { ...onboarding, signupRef: owned.signupRef };
}

/**
 * Reconhece uma conta nao confirmada criada pelo fluxo anterior sem alterar o Auth.
 *
 * A tentativa precisa continuar reservada, o e-mail deve ser exato e a conta
 * nao pode ter profile, convite, banimento ou qualquer marker Qoro. O marker so
 * sera escrito depois do OTP e do claim do draft no callback.
 */
export async function validateLegacySignupDeliveryCandidate(input: {
  userId: string;
  email: string;
  signupRef: string;
  attemptEpoch: number;
  stage: 'initial' | 'resend';
}): Promise<ValidateLegacySignupDeliveryCandidateOutcome> {
  const parsed = legacyDeliveryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'unavailable' };

  try {
    const attempt = await readSignupDeliveryAttemptState({
      signupRef: parsed.data.signupRef,
      attemptEpoch: parsed.data.attemptEpoch,
      kind: parsed.data.stage,
      userId: parsed.data.userId,
    });
    if (attempt !== 'pending') return { ok: false, reason: 'obfuscated' };

    const profile = await readAuthoritativeProfile(parsed.data.userId);
    if (profile) return { ok: false, reason: 'obfuscated' };

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (error) return { ok: false, reason: 'unavailable' };
    const user = data.user;
    if (
      !user ||
      user.id !== parsed.data.userId ||
      user.email?.trim().toLowerCase() !== parsed.data.email.toLowerCase() ||
      user.email_confirmed_at ||
      (typeof user.invited_at === 'string' && user.invited_at.length > 0) ||
      (typeof user.banned_until === 'string' && user.banned_until.length > 0) ||
      hasSignupAuthBindingMarker(user)
    ) {
      return { ok: false, reason: 'obfuscated' };
    }

    return { ok: true, user };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Valida a identidade Auth antes do claim, sem escrever metadata.
 *
 * Dois links de drafts diferentes podem chegar ao mesmo tempo. Reatar o marker
 * nesta fase permitiria que ambos escrevessem antes de o banco escolher o draft
 * vencedor. A primeira fase do callback, portanto, e deliberadamente read-only.
 */
export async function validateVerifiedSignupAuthUserForClaim(input: {
  userId: string;
  email: string;
}): Promise<ValidateVerifiedSignupAuthUserOutcome> {
  const parsed = verifiedUserInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'unavailable' };

  try {
    const profile = await readAuthoritativeProfile(parsed.data.userId);
    if (profile) return { ok: false, reason: 'obfuscated' };
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (error) return { ok: false, reason: 'unavailable' };
    const user = data.user;
    if (
      !user ||
      user.id !== parsed.data.userId ||
      user.email?.trim().toLowerCase() !== parsed.data.email.toLowerCase() ||
      !user.email_confirmed_at ||
      !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
      (typeof user.invited_at === 'string' && user.invited_at.length > 0) ||
      (typeof user.banned_until === 'string' && user.banned_until.length > 0)
    ) {
      return { ok: false, reason: 'obfuscated' };
    }
    if (readPendingSignupReference(user) !== null) return { ok: true, binding: 'pending' };
    if (hasSignupAuthBindingMarker(user)) return { ok: false, reason: 'obfuscated' };
    return { ok: true, binding: 'legacy' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Reata uma conta Qoro passwordless órfã a um draft novo somente depois que o
 * Auth devolveu uma identidade com e-mail confirmado. Nenhuma rota anônima pode
 * chamar `updateUserById` para trocar esse vínculo.
 */
export async function ensureVerifiedSignupAuthBinding(input: {
  userId: string;
  email: string;
  signupRef: string;
}): Promise<EnsureVerifiedSignupAuthBindingOutcome> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'unavailable' };

  try {
    const profile = await readAuthoritativeProfile(parsed.data.userId);
    if (profile) return { ok: false, reason: 'obfuscated' };
    const owned = await readOwnedSignupReference(parsed.data.userId, parsed.data.email);
    if (!owned.ok) {
      return {
        ok: false,
        reason: owned.reason === 'unavailable' ? 'unavailable' : 'obfuscated',
      };
    }
    if (owned.signupRef !== parsed.data.signupRef) {
      return { ok: false, reason: 'obfuscated' };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (error) return { ok: false, reason: 'unavailable' };
    const user = data.user;
    if (
      !user ||
      user.id !== parsed.data.userId ||
      user.email?.trim().toLowerCase() !== parsed.data.email.toLowerCase() ||
      !user.email_confirmed_at ||
      !Number.isFinite(Date.parse(user.email_confirmed_at))
    ) {
      return { ok: false, reason: 'obfuscated' };
    }
    if (isPendingSignupUserBound(user, parsed.data.signupRef)) return { ok: true };
    const current = readSignupAuthBinding(user);
    // Uma recarga tardia da tela confirmada pode acontecer depois do handoff.
    // Se banco e Auth ja apontam para a mesma referencia pronta, a reparacao e
    // idempotente; marker `set` para outra referencia continua recusado.
    if (current?.passwordState === 'set' && current.signupRef === parsed.data.signupRef) {
      return { ok: true };
    }

    let appMetadata: Record<string, unknown>;
    const pendingRef = readPendingSignupReference(user);
    if (pendingRef !== null) {
      appMetadata = rebindPendingSignupAppMetadata(user, parsed.data.signupRef);
    } else {
      if (hasSignupAuthBindingMarker(user)) return { ok: false, reason: 'obfuscated' };
      appMetadata = bindLegacyVerifiedSignupAppMetadata(user, parsed.data.signupRef);
    }

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
      parsed.data.userId,
      { app_metadata: appMetadata },
    );
    if (updateError || !isPendingSignupUserBound(updated.user, parsed.data.signupRef)) {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Migra a conta pré-tenant da implementação anterior somente depois de o login
 * por senha ter sido aceito. A linha `email_verified` pertencente ao mesmo user
 * e ao mesmo HMAC de e-mail fornece a referência; nenhum dado do browser a escolhe.
 */
export async function ensurePasswordAuthenticatedSignupAuthBinding(input: {
  userId: string;
  email: string;
}): Promise<EnsureVerifiedSignupAuthBindingOutcome> {
  const parsed = verifiedUserInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'unavailable' };

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (error) return { ok: false, reason: 'unavailable' };
    const user = data.user;
    if (
      !user ||
      user.id !== parsed.data.userId ||
      user.email?.trim().toLowerCase() !== parsed.data.email.toLowerCase() ||
      !user.email_confirmed_at ||
      !Number.isFinite(Date.parse(user.email_confirmed_at))
    ) {
      return { ok: false, reason: 'obfuscated' };
    }
    const current = readSignupAuthBinding(user);
    // A password chosen before email proof cannot become trusted merely through
    // a password login after someone else confirmed that address on another device.
    if (hasUntrustedInitialSignupPassword(user)) {
      return { ok: false, reason: 'obfuscated' };
    }
    if (current?.passwordState === 'set') {
      await resumeRetainedOwnedSignupDraft(
        parsed.data.userId,
        parsed.data.email,
        current.signupRef,
      );
    }
    if (hasSignupAuthBindingMarker(user) && !current) {
      return { ok: false, reason: 'obfuscated' };
    }
    const owned = await readOwnedSignupReference(parsed.data.userId, parsed.data.email);
    if (!owned.ok && owned.reason === 'unavailable') {
      return { ok: false, reason: 'unavailable' };
    }
    if (
      owned.ok &&
      current?.passwordState === 'set' &&
      current.signupRef !== owned.signupRef &&
      owned.credentialState !== null
    ) {
      return { ok: false, reason: 'obfuscated' };
    }
    // Uma conta antiga pode ter confirmado o Auth sem o callback conseguir
    // reivindicar o draft, ou o draft pode ter expirado. A prova de senha permite
    // instalar um marker ready novo; a próxima tela recria o draft se necessário.
    const signupRef = owned.ok
      ? owned.signupRef
      : (current?.signupRef ?? randomBytes(32).toString('hex'));
    if (current?.signupRef === signupRef && current.passwordState === 'set') {
      return { ok: true };
    }

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
      parsed.data.userId,
      { app_metadata: markPasswordAuthenticatedSignupReady(user, signupRef) },
    );
    const binding = updated.user ? readSignupAuthBinding(updated.user) : null;
    if (updateError || binding?.signupRef !== signupRef || binding.passwordState !== 'set') {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Valida a autoridade usada pelo recovery sem aceitar divergência entre Auth e banco.
 * Marker `set` divergente falha fechado, e órfãos usam o epoch autoritativo do Auth.
 *
 * Marker `pending` (P-29, 20/11/2026): a conta já confirmada que nunca concluiu a senha do
 * cadastro (por exemplo, quem confirmou pelo link e abandonou, ou a conta legada cuja senha
 * não confirmada o Auth apagou na prova de recovery) recebe o grant curto, para que o dono do
 * e-mail, provado pelo próprio link de recovery, instale a primeira senha. Só pela mesma
 * referência do draft possuído e sem instalação em andamento (`completed`/`uncertain`, nunca
 * `reserved`), ou pelo caminho órfão de uso único quando o draft já expirou. Conta não
 * confirmada, convidada, banida ou com outra referência continua recusada.
 */
export async function ensureReadyOwnedSignupAuthBinding(input: {
  userId: string;
  email: string;
}): Promise<EnsureReadyOwnedSignupAuthBindingOutcome> {
  const parsed = verifiedUserInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'unavailable' };
  try {
    const profile = await readAuthoritativeProfile(parsed.data.userId);
    if (profile) return { ok: false, reason: 'obfuscated' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const owned = await readOwnedSignupReference(parsed.data.userId, parsed.data.email);
  if (!owned.ok && owned.reason === 'unavailable') {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (error) return { ok: false, reason: 'unavailable' };
    const user = data.user;
    const current = user ? readSignupAuthBinding(user) : null;
    if (
      !user ||
      user.id !== parsed.data.userId ||
      user.email?.trim().toLowerCase() !== parsed.data.email.toLowerCase() ||
      !user.email_confirmed_at ||
      !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
      (typeof user.invited_at === 'string' && user.invited_at.length > 0) ||
      (typeof user.banned_until === 'string' && user.banned_until.length > 0)
    ) {
      return { ok: false, reason: 'obfuscated' };
    }
    if (current?.passwordState === 'pending') {
      if (owned.ok) {
        if (
          current.signupRef === owned.signupRef &&
          (owned.credentialState === 'uncertain' || owned.credentialState === 'completed')
        ) {
          // Não promove o marker e não toca a senha. O OTP de recovery emitirá um
          // grant curto; só ele poderá disputar o CAS `completed|uncertain -> reserved`.
          return { ok: true, signupRef: owned.signupRef };
        }
        return { ok: false, reason: 'obfuscated' };
      }
      // Draft expirado: o grant órfão é de uso único pelo epoch do Auth e a troca relê a conta.
      const orphanEpoch = Date.parse(user.updated_at ?? '');
      if (!Number.isFinite(orphanEpoch) || orphanEpoch < 0) {
        return { ok: false, reason: 'obfuscated' };
      }
      return { ok: true, signupRef: current.signupRef, orphanEpoch };
    }
    if (hasSignupAuthBindingMarker(user) && !current) {
      return { ok: false, reason: 'obfuscated' };
    }
    if (!owned.ok) {
      // Recovery do proprio e-mail continua valido depois que o draft sem
      // billing expirou. Nesse caso nao ha linha para oferecer CAS; o timestamp
      // autoritativo do Auth vira o epoch curto do grant e sera relido antes da
      // troca de senha. Marker pending/ausente continua recusado.
      const orphanEpoch = Date.parse(user.updated_at ?? '');
      if (current?.passwordState !== 'set' || !Number.isFinite(orphanEpoch) || orphanEpoch < 0) {
        return { ok: false, reason: 'obfuscated' };
      }
      return { ok: true, signupRef: current.signupRef, orphanEpoch };
    }
    if (current?.passwordState === 'set') {
      if (current.signupRef !== owned.signupRef) {
        return { ok: false, reason: 'obfuscated' };
      }
      return { ok: true, signupRef: owned.signupRef };
    }

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
      parsed.data.userId,
      { app_metadata: markPasswordAuthenticatedSignupReady(user, owned.signupRef) },
    );
    const binding = updated.user ? readSignupAuthBinding(updated.user) : null;
    if (updateError || binding?.signupRef !== owned.signupRef || binding.passwordState !== 'set') {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, signupRef: owned.signupRef };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
