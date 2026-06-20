/**
 * requireRecentAal2 (C15) — exige MFA (AAL2) provado RECENTEMENTE.
 *
 * `requireSuperAdmin()` garante AAL2 na sessão, mas a elevação pode ter ocorrido
 * há ~1h (TTL do access token). Para ações sensíveis como iniciar um impersonate
 * (OR-I1), exigimos uma prova fresca de MFA — padrão de bancos ("step-up auth").
 *
 * Implementação: lê o claim `amr` (Authentication Methods References) do JWT,
 * que o Supabase popula com `{ method, timestamp }` por fator. Pegamos o
 * timestamp mais recente de um método de MFA e comparamos com a janela.
 * Sem evidência de MFA recente → lança (UI redireciona para /login/mfa).
 *
 * Server-only.
 */
import 'server-only';

import { AuthError } from './tenant-context';
import { createServerClient } from './supabase-server';

interface AmrEntry {
  method: string;
  timestamp: number; // unix seconds
}

/** Métodos do `amr` que contam como MFA (elevam para AAL2). */
const MFA_METHODS = new Set(['totp', 'mfa', 'webauthn', 'phone']);

export async function requireRecentAal2(maxAgeMinutes = 10): Promise<void> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    throw new AuthError('Sessão inválida para ação sensível', 'unauthenticated', 401);
  }
  const raw = data.claims as Record<string, unknown>;

  if (raw.aal !== 'aal2') {
    throw new AuthError('Ação exige MFA (AAL2). Reautentique com TOTP.', 'forbidden', 403);
  }

  const amr = Array.isArray(raw.amr) ? (raw.amr as unknown[]) : [];
  const mfaTimestamps = amr
    .filter(
      (e): e is AmrEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as AmrEntry).method === 'string' &&
        typeof (e as AmrEntry).timestamp === 'number',
    )
    .filter((e) => MFA_METHODS.has(e.method))
    .map((e) => e.timestamp * 1000);

  if (mfaTimestamps.length === 0) {
    // AAL2 sem timestamp de MFA rastreável: não conseguimos provar frescor →
    // tratamos como expirado (re-challenge). Falha segura.
    throw new AuthError(
      'Reautentique com MFA para confirmar esta ação.',
      'forbidden',
      403,
    );
  }

  const ageMs = Date.now() - Math.max(...mfaTimestamps);
  if (ageMs > maxAgeMinutes * 60_000) {
    throw new AuthError(
      `MFA expirado para esta ação (>${maxAgeMinutes}min). Reautentique com TOTP.`,
      'forbidden',
      403,
    );
  }
}
