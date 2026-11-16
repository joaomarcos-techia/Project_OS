/**
 * Só para testes das telas de Convênios: monta o resultado de `conveniosAccess` a partir dos códigos
 * da matriz I.2, com a mesma derivação do servidor (`rights.ts`). Assim o teste diz QUEM é a pessoa
 * (gestora, recepção, financeiro, médica), não flags soltas.
 */
import { conveniosRights, guideScopeFor } from '@/contexts/health-insurance/rights';
import type { PremiumDenial } from '@/lib/premium-access';

export const PROFILES = {
  gestor: ['view:convenios', 'manage:convenios', 'operate:convenios', 'view:faturamento_convenio', 'manage:faturamento_convenio', 'view:financial', 'manage:financial'],
  recepcao: ['view:convenios', 'operate:convenios', 'view:financial'],
  financeiro: ['view:convenios', 'view:faturamento_convenio', 'manage:faturamento_convenio', 'view:financial', 'manage:financial'],
  /** Vê o faturamento sem agir (ex.: concessão individual de ver valores). */
  leitura: ['view:convenios', 'view:faturamento_convenio'],
  medica: ['view:convenios'],
} as const;

export function accessFor(
  permissions: readonly string[],
  extra: { commercial?: PremiumDenial | null; userId?: string } = {},
) {
  const rights = conveniosRights(permissions);
  const userId = extra.userId ?? 'u1';
  const scope = guideScopeFor(rights, userId);
  return {
    ok: true as const,
    clinicId: 'c1',
    userId,
    rights,
    scope,
    guideView: { scope, values: rights.seeValues },
    commercial: extra.commercial ?? null,
  };
}
