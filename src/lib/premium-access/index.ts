/**
 * Verificação central de recurso premium (D24). Primitiva de plataforma, como o
 * gate de escrita (`@/lib/tenant-access`): vale para Convênios, cobrança de
 * pacientes pelo Asaas e Agentes de IA, em API, Server Action, service, worker e
 * integração.
 *
 * A decisão é do banco (`public.qoro_premium_denial`, 0151), presa à clínica da
 * sessão. Rodar DENTRO da transação da operação: a leitura enxerga o mesmo estado
 * que a escrita, e os gatilhos da 0151 conferem de novo na gravação.
 *
 * Falha FECHADA: diferente do gate de escrita (que falha aberto para não trancar
 * o provisionamento), recurso premium é opt-in. Sem clínica, sem assinatura ou
 * plano desconhecido = negado.
 */
import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import {
  isPremiumDenial,
  PremiumAccessError,
  type PremiumDenial,
  type PremiumFeature,
} from './policy';

export {
  PREMIUM_DENIALS,
  PREMIUM_FEATURE_LABELS,
  PREMIUM_FEATURES,
  PremiumAccessError,
  premiumAccessErrorFrom,
  premiumDenialMessage,
  type PremiumDenial,
  type PremiumFeature,
} from './policy';

export interface PremiumSql {
  execute(statement: SQL): PromiseLike<unknown>;
}

/** `null` = liberado; senão, o motivo da negativa. */
export async function getPremiumDenialTx(
  tx: PremiumSql,
  clinicId: string,
  feature: PremiumFeature,
): Promise<PremiumDenial | null> {
  const rows = (await tx.execute(
    sql`SELECT public.qoro_premium_denial(${clinicId}::uuid, ${feature}) AS denial`,
  )) as unknown as Array<{ denial: string | null }>;
  const denial = rows[0]?.denial ?? null;
  if (denial === null) return null;
  // Motivo fora da lista = contrato quebrado entre banco e app: nega com o genérico.
  return isPremiumDenial(denial) ? denial : 'subscription_inactive';
}

/** Lança `PremiumAccessError` (mensagem de usuário) quando o recurso não está liberado. */
export async function assertPremiumFeatureTx(
  tx: PremiumSql,
  clinicId: string,
  feature: PremiumFeature,
): Promise<void> {
  const denial = await getPremiumDenialTx(tx, clinicId, feature);
  if (denial) throw new PremiumAccessError(feature, denial);
}
