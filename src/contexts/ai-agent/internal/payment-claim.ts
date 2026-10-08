/**
 * Resposta ao "já paguei" (08/10/2026, EC-22) — texto do SERVIDOR, sem LLM.
 *
 * Antes, o agente não tinha o que consultar e respondia genérico. Agora ele lê o
 * status REAL da cobrança (o que o Asaas confirmou) e nunca dá nada como pago
 * pela palavra do paciente nem por foto de comprovante.
 *
 * Decisão do usuário, mesma data: com o sinal ligado, o horário só se confirma
 * com o sinal pago pelo link; o restante pode ser pago na clínica, inclusive em
 * dinheiro. Por isso:
 *  - pago → confirma, com o valor;
 *  - pendente → a confirmação ainda não chegou; se o paciente insiste, equipe;
 *  - em dinheiro → quem confirma é a equipe (o sinal, só pelo link);
 *  - nenhuma cobrança → a equipe confere.
 */
/* eslint-disable boundaries/element-types -- o tipo vem da API pública do Payments (M14). */
import type { PatientChargeStatus } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

export interface PaymentClaimDecision {
  text: string;
  /** Motivo da fila de atendimento humano; `null` = o agente segue na conversa. */
  handoffReason: string | null;
}

/** Começo do aviso de pendente: é por ele que o servidor reconhece a insistência. */
export const PAYMENT_PENDING_PREFIX = 'Ainda não recebemos a confirmação do pagamento';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (value: number): string => money.format(value).replace(/ /g, ' ');

/** A cobrança de que o paciente fala: a pendente mais recente, senão a paga mais recente. */
export function relevantCharge(
  charges: readonly PatientChargeStatus[],
): PatientChargeStatus | null {
  return (
    charges.find((charge) => charge.status === 'pending') ??
    charges.find((charge) => charge.status === 'paid') ??
    null
  );
}

export function decidePaymentClaimReply(args: {
  charges: readonly PatientChargeStatus[];
  cash: boolean;
  /** A última resposta do agente já foi o aviso de pendente. */
  insisting: boolean;
  /** Data e hora da consulta da cobrança relevante, já no formato do paciente. */
  appointmentWhen: string | null;
  /** Prazo do hold, já no formato do paciente. */
  holdUntil: string | null;
}): PaymentClaimDecision {
  const charge = relevantCharge(args.charges);

  if (!charge) {
    return {
      text: 'Não encontrei nenhuma cobrança em aberto no seu cadastro. Vou passar para a equipe conferir e te retornar por aqui.',
      handoffReason: 'payment_claim_no_charge',
    };
  }

  if (charge.status === 'paid') {
    if (charge.kind === 'deposit') {
      return {
        text: `Recebemos o pagamento do sinal (${brl(charge.amount)}).${
          args.appointmentWhen ? ` Sua consulta de ${args.appointmentWhen} está confirmada.` : ''
        }`,
        handoffReason: null,
      };
    }
    return { text: `Recebemos o seu pagamento de ${brl(charge.amount)}. Obrigado!`, handoffReason: null };
  }

  if (args.cash) {
    return charge.kind === 'deposit'
      ? {
          text: 'O sinal é pago pelo link que enviamos por aqui, e é ele que confirma o seu horário. O restante pode ser pago na clínica, inclusive em dinheiro. Vou pedir para a equipe conferir o seu caso.',
          handoffReason: 'payment_claim_cash',
        }
      : {
          text: 'Pagamento em dinheiro é registrado pela equipe da clínica. Já avisei a equipe para dar baixa e te retornar por aqui.',
          handoffReason: 'payment_claim_cash',
        };
  }

  if (args.insisting) {
    return {
      text: 'Vou pedir para a equipe conferir o seu pagamento e te retornar por aqui.',
      handoffReason: 'payment_claim_unconfirmed',
    };
  }

  const hold =
    charge.kind === 'deposit' && args.holdUntil
      ? ` O seu horário fica reservado até ${args.holdUntil}.`
      : '';
  return {
    text: `${PAYMENT_PENDING_PREFIX} de ${brl(charge.amount)}. Pelo link, ela costuma chegar em poucos minutos.${hold} Se você pagou há mais tempo, me avise que eu peço para a equipe conferir.`,
    handoffReason: null,
  };
}
