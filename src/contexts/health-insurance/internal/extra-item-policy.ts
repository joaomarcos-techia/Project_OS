/**
 * P8.4-r — política APROVADA pelo fundador em 24/11/2026 (docs/convenios/decisao-p84r.md,
 * "Decisão de 24/11") para o procedimento executado na sessão SP/SADT além do solicitado
 * (`hi_appointment_extra_items`, migration 0167):
 *
 *  1. o registro clínico legítimo fica sempre (nada é apagado por falta de autorização);
 *  2. nada entra na guia sozinho: a inclusão é uma ação explícita do faturamento;
 *  3. contrato que EXIGE autorização: só com a autorização concedida da solicitação da sessão,
 *     do mesmo procedimento, com saldo para a quantidade, ligada ao item (regularização); a
 *     inclusão consome o saldo uma vez;
 *  4. contrato que DISPENSA autorização: entra pela ação "Incluir na guia" do faturamento;
 *  5. guia com item pendente não é aprovada em silêncio: inclui-se o item ou aprova-se a guia
 *     sem ele, com motivo;
 *  6. item não faturado fica registrado, com motivo, quem e quando, fora do XML e do recebível;
 *  7. operadora: nada é presumido. Regra desconhecida → a inclusão pede a confirmação de que o
 *     contrato permite; proibição registrada → o item não entra na guia dessa operadora.
 *
 * Função PURA: a mesma decisão alimenta a tela (o que mostrar e oferecer) e o serviço (o que
 * aceitar). O banco confere de novo as transições (gatilhos da 0167).
 */
import type { InsurerExtraItemsRule } from './insurer-rules';

export const EXTRA_ITEM_POLICY = 'p84r-2026-11-24' as const;

export type ExtraItemStatus = 'recorded' | 'regularized' | 'included' | 'excluded' | 'cancelled';
export const EXTRA_ITEM_STATUSES: readonly ExtraItemStatus[] = ['recorded', 'regularized', 'included', 'excluded', 'cancelled'];

/** Etapa das guias vivas da sessão (`hi_extra_item_guide_state`). */
export type SessionGuideState = 'none' | 'open' | 'reviewed' | 'closed';

export type ExtraItemStage =
  /** Exige autorização e não há autorização da solicitação que sirva. */
  | 'awaiting_authorization'
  /** Exige autorização e há uma concedida, com saldo, que a recepção pode ligar. */
  | 'authorization_available'
  /** Pronto para o faturamento decidir: incluir na guia ou não faturar. */
  | 'ready_to_include'
  /** A autorização ligada deixou de servir (cancelada, vencida ou sem saldo). */
  | 'authorization_invalid'
  /** A operadora está registrada como "não aceita item regularizado depois da sessão". */
  | 'insurer_forbids'
  | 'included'
  /** Estava na guia, que foi cancelada; a sessão tem guia nova sem ele. */
  | 'included_in_dead_guide'
  | 'not_billed'
  | 'cancelled';

export interface ExtraItemFacts {
  status: ExtraItemStatus;
  requiresAuthorization: boolean;
  quantity: number;
  guideState: SessionGuideState;
  insurerRule: InsurerExtraItemsRule;
  /** Só para `recorded` que exige: autorização concedida da solicitação da sessão, com saldo ≥ quantidade. */
  candidateAuthorization: { itemId: string; remaining: number } | null;
  /** Só para `regularized`: o problema atual da autorização ligada (null = serve). */
  linkedAuthorizationProblem: string | null;
  /** Só para `included`: alguma guia viva cobra este procedimento da sessão? */
  billedInLiveGuide: boolean;
}

export interface ExtraItemDecision {
  stage: ExtraItemStage;
  /** Pendência que impede a aprovação silenciosa da guia (regra 5). */
  pending: boolean;
  /** O que cada papel pode fazer agora (o servidor confere de novo). */
  canRegularize: boolean;
  canInclude: boolean;
  canExclude: boolean;
  canCancel: boolean;
  /** Incluir exige confirmar que o contrato da operadora aceita (regra da operadora desconhecida). */
  includeNeedsInsurerConfirmation: boolean;
  /** Mensagem para a tela, sem valor e sem dado clínico. */
  message: string;
}

const editable = (s: SessionGuideState) => s === 'none' || s === 'open';
const notApproved = (s: SessionGuideState) => s !== 'closed';

export function decideExtraItem(f: ExtraItemFacts): ExtraItemDecision {
  if (!Number.isInteger(f.quantity) || f.quantity < 1 || f.quantity > 999) {
    throw new RangeError('quantidade do item executado fora de 1 a 999');
  }
  const none = { canRegularize: false, canInclude: false, canExclude: false, canCancel: false, includeNeedsInsurerConfirmation: false };
  switch (f.status) {
    case 'cancelled':
      return { ...none, stage: 'cancelled', pending: false, message: 'Registro cancelado; fica no histórico.' };
    case 'excluded':
      return { ...none, stage: 'not_billed', pending: false, message: 'Não faturado por decisão; o registro fica no atendimento.' };
    case 'included':
      if (f.billedInLiveGuide) return { ...none, stage: 'included', pending: false, message: 'Incluído na guia.' };
      return {
        ...none,
        stage: 'included_in_dead_guide',
        pending: true,
        canInclude: f.guideState === 'open',
        canExclude: notApproved(f.guideState),
        message: 'A guia em que o item entrou foi cancelada. Inclua o item na guia nova da sessão ou registre que não será faturado.',
      };
    case 'recorded':
    case 'regularized': {
      const base = { canCancel: editable(f.guideState), canExclude: notApproved(f.guideState) };
      if (f.insurerRule === 'forbids') {
        return {
          ...none,
          ...base,
          stage: 'insurer_forbids',
          pending: true,
          message: 'Esta operadora está registrada como não aceita item regularizado depois da sessão: registre que não será faturado, com o motivo.',
        };
      }
      const confirm = f.insurerRule === 'unknown';
      if (!f.requiresAuthorization) {
        return {
          ...none,
          ...base,
          stage: 'ready_to_include',
          pending: true,
          canInclude: f.guideState === 'open',
          includeNeedsInsurerConfirmation: confirm,
          message: 'O contrato dispensa autorização. O faturamento decide: incluir na guia ou não faturar, com motivo.',
        };
      }
      if (f.status === 'recorded') {
        if (f.candidateAuthorization && f.candidateAuthorization.remaining >= f.quantity) {
          return {
            ...none,
            ...base,
            stage: 'authorization_available',
            pending: true,
            canRegularize: notApproved(f.guideState),
            message: 'Há autorização concedida para este procedimento na solicitação da sessão. Ligue a autorização ao item antes de incluir.',
          };
        }
        return {
          ...none,
          ...base,
          stage: 'awaiting_authorization',
          pending: true,
          message: f.candidateAuthorization
            ? `O saldo autorizado (${f.candidateAuthorization.remaining}) é menor que a quantidade executada (${f.quantity}). Peça a autorização à operadora ou registre que não será faturado.`
            : 'O contrato exige autorização e a solicitação da sessão não tem autorização concedida para este procedimento. Peça a autorização à operadora ou registre que não será faturado.',
        };
      }
      if (f.linkedAuthorizationProblem) {
        return {
          ...none,
          ...base,
          stage: 'authorization_invalid',
          pending: true,
          message: `A autorização ligada não serve mais: ${f.linkedAuthorizationProblem}. Registre que não será faturado ou resolva com a operadora.`,
        };
      }
      return {
        ...none,
        ...base,
        stage: 'ready_to_include',
        pending: true,
        canInclude: f.guideState === 'open',
        includeNeedsInsurerConfirmation: confirm,
        message: 'Autorização ligada, com saldo. O faturamento decide: incluir na guia (consome o saldo) ou não faturar, com motivo.',
      };
    }
  }
}

/** Mensagem de bloqueio da aprovação com itens pendentes (regra 5). */
export function pendingApprovalMessage(count: number): string {
  return count === 1
    ? 'Há 1 item executado adicional pendente nesta guia: inclua o item na guia ou aprove sem ele, informando o motivo.'
    : `Há ${count} itens executados adicionais pendentes nesta guia: inclua os itens na guia ou aprove sem eles, informando o motivo.`;
}
