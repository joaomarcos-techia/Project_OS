/**
 * Serviço de capacidade clínica do Identity (ADR-032 §2).
 *
 * `getCurrentPractitioner` resolve se o USUÁRIO LOGADO é practitioner. Existe porque
 * a sessão (JWT) carrega `app_role` mas NÃO `crm` — então o owner-médico precisa de
 * UMA leitura do profile para o predicado. É regra + fetch (não uma query pura), por
 * isso vive em `internal/` e não em `queries.ts`.
 *
 * Quem já tem o profile em mãos (role+crm) usa `isPractitioner()` puro — sem fetch.
 *
 * Server-only.
 */
import 'server-only';

import { cache } from 'react';

import { and, eq, isNull } from 'drizzle-orm';

import { isPractitioner } from '@/lib/auth/practitioner';
import { requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

import { profiles } from '../schema';

/**
 * Resolve UMA vez por request (React.cache — mesmo padrão do `getCurrentUser`) se o
 * usuário logado tem capacidade clínica. Evita o N+1 dashboard → agenda → consultório.
 *
 * `role === 'doctor'` curto-circuita antes de qualquer leitura (é practitioner pelo
 * role); só os demais papéis pagam 1 PK-lookup para o caso owner-médico.
 */
export const getCurrentPractitioner = cache(async (): Promise<boolean> => {
  const user = await requireUser();
  if (!user.clinicId) return false;
  if (user.role === 'doctor') return true;

  const clinicId = user.clinicId;
  const [row] = await withTenant(clinicId, (tx) =>
    tx
      .select({ crm: profiles.crm })
      .from(profiles)
      .where(and(eq(profiles.id, user.userId), isNull(profiles.deletedAt)))
      .limit(1),
  );

  return isPractitioner({ role: user.role, crm: row?.crm ?? null });
});
