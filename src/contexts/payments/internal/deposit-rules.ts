/**
 * Regras puras do sinal que dependem do gateway e do relógio, sem banco e sem
 * nenhum outro context (08/10/2026). Saíram do `deposit-charge.ts` para que a
 * prévia do sinal (`deposit-preview.ts`) as use sem importar a API do Scheduling:
 * o índice público do Payments é importado pela agenda, e um import do Scheduling
 * aqui fecharia um ciclo (o `madge` do CI pegou).
 */

/** Janela do hold (ADR-049). Fixa: é promessa ao paciente, não configuração. */
const HOLD_HOURS = 24;

/**
 * Valor mínimo que o Asaas aceita numa cobrança — **R$ 5,00**, verificado ao vivo
 * em 2026-08-24 (`invalid_value`: *"O valor mínimo para cobranças com a forma de
 * pagamento Pergunte ao Cliente é R$ 5,00"*).
 *
 * Fica AQUI, e não em `policy.ts`, porque é regra do GATEWAY e não do domínio: a
 * política é agnóstica de provedor de propósito. Sem esta guarda, uma clínica com
 * procedimento barato (50% de R$ 8 = R$ 4) geraria uma cobrança que o gateway
 * recusa — o handler trataria como poison pill e o sinal nunca aconteceria, com
 * um erro por agendamento. Não cobrar é o mesmo desfecho, sem o ruído.
 */
export const MIN_GATEWAY_AMOUNT = 5;

/**
 * O hold nunca pode ultrapassar o horário da consulta: segurar uma vaga até depois
 * dela ter acontecido não segura nada — só impede a agenda de liberar o horário
 * para outro paciente a tempo.
 */
export function resolveHoldExpiry(now: Date, scheduledAt: Date): Date {
  const nominal = new Date(now.getTime() + HOLD_HOURS * 60 * 60 * 1000);
  return nominal.getTime() < scheduledAt.getTime() ? nominal : scheduledAt;
}
