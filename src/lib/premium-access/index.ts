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

import { metrics } from '@/lib/observability/metrics';

import {
  isPremiumDenial,
  PremiumAccessError,
  premiumAccessErrorFrom as translatePremiumError,
  type PremiumDenial,
  type PremiumFeature,
} from './policy';

export {
  PREMIUM_DENIALS,
  PREMIUM_FEATURE_LABELS,
  PREMIUM_FEATURES,
  PremiumAccessError,
  premiumDenialMessage,
  type PremiumDenial,
  type PremiumFeature,
} from './policy';

/**
 * Toda negativa comercial vira evento observável, como a de permissão (`authz.denied`, SEC-050).
 * Sem isso, uma clínica em trial ou suspensa chamando a action direto deixava só a mensagem na
 * tela: a auditoria da operação morre no rollback e nada era contado (achado de 15/11, noite).
 *
 * Só campos estruturais (recurso, motivo, onde foi barrada): nada de mensagem, paciente ou
 * clínica no campo (a correlação ambiente, quando houver, vem do `contextFields`). Uma vez por
 * negativa: o mesmo erro traduzido de novo devolve a mesma instância e não conta duas vezes.
 * Mora aqui (server-only), não em `policy.ts`, que é importado por módulos puros.
 */
const signalled = new WeakSet<PremiumAccessError>();
const translated = new WeakMap<object, PremiumAccessError>();

function signalPremiumDenial(error: PremiumAccessError, source: 'service' | 'database'): void {
  if (signalled.has(error)) return;
  signalled.add(error);
  // Telemetria nunca decide nada: se a emissão falhar (stdout fechado, serialização), a negativa
  // segue a mesma, com a mesma mensagem. Falhar aqui não pode abrir a operação nem trocar o erro.
  try {
    metrics.emit('premium.denied', { feature: error.feature, reason: error.reason, source });
  } catch {
    // sem efeito: a recusa já está decidida pelo banco
  }
}

/**
 * Traduz SÓ o erro conhecido do banco (`23514` + `qoro_premium_<feature>`) e conta a negativa
 * uma vez. A negativa do serviço (`assertPremiumFeatureTx`) já foi contada ao ser lançada.
 */
export function premiumAccessErrorFrom(error: unknown): PremiumAccessError | null {
  if (error instanceof PremiumAccessError) {
    signalPremiumDenial(error, 'service');
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const cached = translated.get(error);
    if (cached) return cached;
  }
  const premium = translatePremiumError(error);
  if (!premium) return null;
  if (typeof error === 'object' && error !== null) translated.set(error, premium);
  // Negativa do serviço embrulhada (cause) já foi contada; a do gatilho do banco conta aqui.
  signalPremiumDenial(premium, 'database');
  return premium;
}

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
  if (denial) {
    const error = new PremiumAccessError(feature, denial);
    signalPremiumDenial(error, 'service');
    throw error;
  }
}
