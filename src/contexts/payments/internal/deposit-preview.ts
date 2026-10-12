/**
 * O sinal que um agendamento NOVO vai cobrar, antes de ele existir (08/10/2026).
 *
 * Mesma decisão do `createDepositCharge`, sem efeito nenhum: o agente usa no
 * resumo para dizer ao paciente que o horário só se confirma com o sinal pago
 * pelo link e quanto fica para pagar na clínica — e para não oferecer "tudo em
 * dinheiro" quando há sinal (decisão do usuário: com o sinal ligado, o
 * agendamento só se confirma com o sinal pago online; o restante pode ser em
 * dinheiro). Conta Asaas e CPF ainda podem impedir o link depois; por isso o
 * agente fala do sinal, nunca promete o envio.
 *
 * Sem import do Scheduling, de propósito: este módulo entra no índice público do
 * Payments, que a agenda importa. Quem chama diz se é retorno, por um callback
 * que só roda quando a política está ligada — a mesma leitura do `isReturnVisit`
 * (qualquer outro agendamento já marcado faz deste um retorno).
 *
 * `scheduledAt` ausente = horário ainda não escolhido: pula só a janela do
 * Checkout, que depende dele.
 */
import { resolveDepositAmount } from '../policy';
import { getDepositPolicy } from '../queries';
import { MIN_GATEWAY_AMOUNT, resolveHoldExpiry } from './deposit-rules';
import { resolveCheckoutWindow } from './hosted-checkout';

export async function previewDepositForBooking(input: {
  clinicId: string;
  patientId: string | null;
  basePrice: number;
  /** O paciente já tem outro agendamento? Só é chamado com a política ligada. */
  isReturnVisit: () => Promise<boolean>;
  scheduledAt?: Date;
  now?: Date;
}): Promise<{ amount: number } | null> {
  if (!input.patientId) return null;
  const policy = await getDepositPolicy(input.clinicId);
  if (!policy.enabled) return null;

  const amount = resolveDepositAmount({
    policy,
    basePrice: input.basePrice,
    isReturn: await input.isReturnVisit(),
  });
  if (amount === null || amount < MIN_GATEWAY_AMOUNT) return null;

  if (input.scheduledAt) {
    const now = input.now ?? new Date();
    if (!resolveCheckoutWindow(now, resolveHoldExpiry(now, input.scheduledAt))) return null;
  }
  return { amount };
}
