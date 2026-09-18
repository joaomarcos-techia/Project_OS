'use server';

/**
 * O-7 — Server Actions do onboarding operacional.
 *
 * REAUTORIZA A CADA CHAMADA, pelo mesmo motivo de `handoff-actions.ts`: o tour
 * roda no cliente e sobrevive a navegações, então quem montou o componente não
 * é prova de nada na hora do clique.
 *
 * O ESCOPO NUNCA VEM DO CLIENTE. `clinicId` sai de `requireClinicId()` e
 * `userId` de `requireUser()`; o corpo aceita apenas a ação, validada contra um
 * enum fechado. Não existe forma de pedir "marque o onboarding da clínica X" ou
 * "do usuário Y" — esses dois valores não têm porta de entrada.
 */
import {
  applyOnboardingAction,
  onboardingActionSchema,
  readOnboardingProgress,
  type OnboardingProgressState,
} from '@/contexts/onboarding';
import { AuthError, requireClinicId, requireUser } from '@/lib/auth/tenant-context';

export type OnboardingActionResult =
  | { ok: true; progress: OnboardingProgressState; changed: boolean }
  /**
   * `stale` pede releitura; `denied` é sessão/tenant inválido. Nenhum dos dois é
   * exceção: negativa esperada não deve virar 500 (OBS-001, ver action-guard.ts).
   */
  | { ok: false; reason: 'stale' | 'denied' | 'invalid'; progress?: OnboardingProgressState };

/** Identidade + clínica, sem exigir permissão: o progresso é de quem está logado. */
async function scope(): Promise<{ clinicId: string; userId: string } | null> {
  try {
    const user = await requireUser();
    const clinicId = await requireClinicId();
    return { clinicId, userId: user.userId };
  } catch (err) {
    if (err instanceof AuthError) return null;
    throw err;
  }
}

export async function submitOnboardingAction(input: unknown): Promise<OnboardingActionResult> {
  const parsed = onboardingActionSchema.safeParse(input);
  // Ação desconhecida ou campo a mais: recusa antes de tocar no banco. `.strict()`
  // no schema é o que impede um `clinicId` viajando de carona ser ignorado em
  // silêncio — aqui ele é motivo de recusa, não de descarte.
  if (!parsed.success) return { ok: false, reason: 'invalid' };

  const who = await scope();
  if (!who) return { ok: false, reason: 'denied' };

  const outcome = await applyOnboardingAction(who.clinicId, who.userId, parsed.data);
  if (!outcome.ok) return { ok: false, reason: outcome.reason, progress: outcome.progress };
  return { ok: true, progress: outcome.progress, changed: outcome.changed };
}

/**
 * Releitura para o cliente se recuperar de `stale` sem recarregar a página.
 *
 * Devolve um envelope, e nunca `null`: `null` confundiria "sua sessão não vale"
 * com "você ainda não tem progresso", e quem chama trataria uma negativa como
 * estado inicial. É também o contrato que `security:http` cobra de toda Server
 * Action — 200 só é aceitável com negativa EXPLÍCITA no corpo.
 */
export type FetchOnboardingProgressResult =
  | { ok: true; progress: OnboardingProgressState }
  | { ok: false; reason: 'denied' };

export async function fetchOnboardingProgress(): Promise<FetchOnboardingProgressResult> {
  const who = await scope();
  if (!who) return { ok: false, reason: 'denied' };
  return { ok: true, progress: await readOnboardingProgress(who.clinicId, who.userId) };
}
