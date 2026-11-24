/**
 * P8.4-r — o que fazer, no FATURAMENTO, com o item executado na sessão SP/SADT sem solicitação
 * prévia (registrado em `hi_appointment_extra_items`, candidata 0167).
 *
 * ISTO NÃO É POLÍTICA APROVADA. As alternativas abaixo são hipóteses para a decisão do fundador
 * (docs/convenios/decisoes-pendentes.md, "P8.4-r"); estão implementadas e testadas para que a
 * decisão vire uma linha de configuração, não um desenvolvimento novo. Enquanto ela não vier, a
 * política vigente é `undecided`: o registro do item fica (o registro do atendimento nunca é
 * bloqueado por falta de autorização financeira) e NADA entra na guia.
 *
 * Em todas as alternativas: o valor só vem do contrato; uma unidade autorizada nunca é usada duas
 * vezes (o consumo segue a chave por sessão e o gatilho da 0146); nada é faturado presumindo
 * autorização.
 */
import type { GuideIssue } from '../tiss/validation/common';

export type ExtraItemPolicy =
  /** Vigente até a decisão: registra, não fatura, avisa que a regra está pendente. */
  | 'undecided'
  /** (a) Bloquear o faturamento do item: fica registrado, nunca entra na guia. */
  | 'block_billing'
  /** (b) Pendência de regularização: a guia da sessão não é aprovada até o item ser regularizado. */
  | 'regularization_pending'
  /** (c) Autorização posterior: fatura quando o contrato não exige autorização ou há saldo autorizado. */
  | 'post_authorization'
  /** (d) Só registro: fica no atendimento, sem cobrança e sem pendência. */
  | 'record_only';

export const EXTRA_ITEM_POLICIES: readonly ExtraItemPolicy[] = [
  'undecided',
  'block_billing',
  'regularization_pending',
  'post_authorization',
  'record_only',
];

/** A política em vigor. Mudar exige a decisão P8.4-r registrada no plano. */
export const ACTIVE_EXTRA_ITEM_POLICY: ExtraItemPolicy = 'undecided';

export interface ExtraItemFacts {
  /** Da linha do contrato (copiado pelo banco no registro). */
  requiresAuthorization: boolean;
  quantity: number;
  /**
   * Autorização concedida pela operadora que cobre ESTE procedimento, para o paciente e a
   * operadora do atendimento, com o saldo ainda livre. `null` quando não há.
   */
  grantedAuthorization: { itemId: string; remaining: number } | null;
}

export type ExtraItemBilling =
  | {
      bill: false;
      /** Pendência mostrada na conferência (null: nenhuma). */
      issue: GuideIssue | null;
      /** A guia da sessão não pode ser aprovada enquanto isto valer. */
      blocksApproval: boolean;
    }
  | {
      bill: true;
      /** Item da autorização consumido (uma vez por sessão), ou null quando o contrato não exige. */
      authorizationItemId: string | null;
    };

const issue = (code: string, owner: GuideIssue['owner'], message: string): GuideIssue => ({
  code,
  field: 'procedimentosExecutados',
  message,
  owner,
});

export function resolveExtraItemBilling(policy: ExtraItemPolicy, facts: ExtraItemFacts): ExtraItemBilling {
  if (!Number.isInteger(facts.quantity) || facts.quantity < 1 || facts.quantity > 999) {
    throw new RangeError('quantidade do item executado fora de 1 a 999');
  }
  switch (policy) {
    case 'undecided':
      return {
        bill: false,
        issue: issue(
          'EXTRA_ITEM_POLICY_PENDING',
          'gestor',
          'Item executado sem solicitação: registrado no atendimento, ainda não faturado. A regra de faturamento desse caso aguarda decisão.',
        ),
        blocksApproval: false,
      };
    case 'block_billing':
      return {
        bill: false,
        issue: issue('EXTRA_ITEM_NOT_BILLED', 'financeiro', 'Item executado sem solicitação: registrado, não faturado nesta guia.'),
        blocksApproval: false,
      };
    case 'regularization_pending':
      return {
        bill: false,
        issue: issue(
          'EXTRA_ITEM_REGULARIZATION',
          'recepcao',
          'Item executado sem solicitação: regularize (solicitação ou autorização da operadora) antes de aprovar a guia.',
        ),
        blocksApproval: true,
      };
    case 'post_authorization': {
      if (!facts.requiresAuthorization) return { bill: true, authorizationItemId: null };
      const g = facts.grantedAuthorization;
      if (g && g.remaining >= facts.quantity) return { bill: true, authorizationItemId: g.itemId };
      return {
        bill: false,
        issue: issue(
          'EXTRA_ITEM_AUTHORIZATION_MISSING',
          'recepcao',
          g
            ? `A autorização registrada tem saldo de ${g.remaining}, menor que a quantidade executada (${facts.quantity}).`
            : 'O contrato exige autorização para este item e não há autorização concedida registrada.',
        ),
        blocksApproval: false,
      };
    }
    case 'record_only':
      return { bill: false, issue: null, blocksApproval: false };
  }
}
