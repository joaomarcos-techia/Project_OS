/**
 * Revogação AUTORITATIVA de sessão — o outro lado do epoch-check do ADR-037.
 *
 * ===================================================================
 * Por que este arquivo existe (pentest 2026-08-15 — AUTH-005/006/007)
 * ===================================================================
 * `tenant-context.ts` já dizia, em letras grandes, que `signOut` NÃO mata o
 * access token: `signOut({scope:'global'})` e `admin.signOut()` revogam
 * REFRESH tokens; o JWT já emitido continua criptograficamente válido até
 * expirar. Quem encerra a sessão em curso é o epoch-check por request.
 *
 * Só que NADA no logout nem na troca de senha bumpava o epoch. O resultado
 * foi medido em produção: um cookie copiado antes do "Sair" continuou abrindo
 * o Dashboard, e uma segunda sessão sobreviveu inteira à troca de senha —
 * incluindo a troca feita por um recovery legítimo, que é justamente o momento
 * em que se quer expulsar o invasor.
 *
 * O epoch já existia. Faltava alguém incrementá-lo nos dois eventos que, para
 * o usuário, SIGNIFICAM "encerre minhas sessões".
 *
 * ===================================================================
 * Por que dbAdmin, e não `signOut`
 * ===================================================================
 * `profiles` não tem policy de UPDATE para `authenticated` (ADR-008 D31) — um
 * UPDATE via RLS casaria zero linhas e falharia ABERTO, em silêncio, que é
 * exatamente o bug (B) que a migration 0040 corrigiu no trigger de overrides.
 * A escrita administrativa em `profiles` via `dbAdmin` com escopo por PK é o
 * padrão já estabelecido em `identity/internal/lifecycle.ts` (ADR-039).
 *
 * Não há duplo bump: o trigger `bump_profile_claims_version` é BEFORE UPDATE e
 * só incrementa quando `role`/`clinic_id`/`ativo` mudam. Aqui só mexemos em
 * `claims_version` — o mesmo raciocínio documentado na 0040 §3.
 *
 * NÃO altera a duração do JWT, não cria blacklist em memória (serverless não
 * tem onde guardar) e não remove o epoch-check. Só usa o mecanismo que já
 * estava lá.
 */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

/* eslint-disable boundaries/element-types -- mesma travessia por PK que o resto de lib/auth já faz para manter a decisão de sessão num ponto só. */
import { profiles } from '@/contexts/identity/schema';
/* eslint-enable boundaries/element-types */
import { dbAdmin } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

/**
 * Incrementa o epoch de sessão do usuário. Todo access token emitido antes
 * desta chamada morre no PRÓXIMO request, e todo refresh subsequente recebe
 * claims novas.
 *
 * @returns `true` se o epoch avançou. `false` significa que o profile não
 *          existe (usuário já removido) — o caller decide se isso é aceitável.
 *          NUNCA devolve `true` sem ter escrito: o chamador precisa poder
 *          distinguir "revoguei" de "achei que revoguei".
 * @throws  Erro de banco. Falha de revogação NÃO pode ser engolida: quem chama
 *          está prestes a dizer ao usuário que ele saiu.
 */
export async function bumpSessionEpoch(userId: string, reason: string): Promise<boolean> {
  const rows = await dbAdmin
    .update(profiles)
    .set({ claimsVersion: sql`${profiles.claimsVersion} + 1` })
    .where(eq(profiles.id, userId))
    .returning({ claimsVersion: profiles.claimsVersion });

  const bumped = rows.length > 0;
  // Mesmo canal do `auth.session.revoked` emitido pelo epoch-check: revogação
  // ativa e revogação percebida ficam correlacionáveis no mesmo gráfico.
  if (bumped) metrics.emit('auth.session.revoked', { reason });
  return bumped;
}

/**
 * Consome um epoch conhecido e o incrementa numa única escrita.
 *
 * Diferente de `bumpSessionEpoch`, este helper só vence quando o profile ainda
 * está exatamente na versão carregada pelo grant. Assim duas requisições com o
 * mesmo recovery nunca chegam juntas à escrita externa da senha.
 */
export async function bumpSessionEpochIfCurrent(
  userId: string,
  expectedClaimsVersion: number,
  reason: string,
): Promise<boolean> {
  const rows = await dbAdmin
    .update(profiles)
    .set({ claimsVersion: sql`${profiles.claimsVersion} + 1` })
    .where(and(eq(profiles.id, userId), eq(profiles.claimsVersion, expectedClaimsVersion)))
    .returning({ claimsVersion: profiles.claimsVersion });

  const bumped = rows.length > 0;
  if (bumped) metrics.emit('auth.session.revoked', { reason });
  return bumped;
}

/**
 * Serializa a única escrita Auth de um recovery sem profile/draft.
 *
 * O lock é transacional e compartilhado por todas as instâncias. A transação
 * deliberadamente cobre a releitura e uma única chamada à Admin API: sem uma
 * linha autoritativa para CAS, soltar o lock antes desse I/O reabriria a corrida.
 */
export async function withOrphanRecoveryLock<T>(
  userId: string,
  work: () => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`qoro:password-recovery:${userId}`}, 0))`,
    );
    return work();
  });
}
