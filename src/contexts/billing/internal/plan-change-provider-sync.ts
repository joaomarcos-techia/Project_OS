import type { PaymentProvider, ProviderPayment } from '@/lib/payments/asaas';

import { toCents } from './money';
import { PlanChangeError } from './plan-changes';

type PlanChangeProvider = Pick<
  PaymentProvider,
  | 'getSubscription'
  | 'updateSubscription'
  | 'listAllSubscriptionPayments'
  | 'getPayment'
  | 'updatePayment'
>;

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const EDITABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);
type BillingType = 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';
const BILLING_TYPES: ReadonlySet<string> = new Set<BillingType>([
  'UNDEFINED',
  'BOLETO',
  'CREDIT_CARD',
  'PIX',
]);

function isBillingType(value: string | null): value is BillingType {
  return value !== null && BILLING_TYPES.has(value);
}

function isTargetCycle(
  payment: ProviderPayment,
  subscriptionId: string,
  firstDueDate: string,
): boolean {
  if (payment.subscriptionId !== subscriptionId || !/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)) {
    throw new PlanChangeError(
      'Cobrança da assinatura sem vínculo ou vencimento verificável.',
      'provider_payment_invalid',
    );
  }
  return payment.dueDate >= firstDueDate;
}

/**
 * Só conclui quando a recorrência E as parcelas já emitidas do novo ciclo têm
 * o valor contratado. Nunca reprecifica dívida de ciclos anteriores. Pode ser
 * repetido após timeout: a releitura decide o que ainda precisa ser alterado.
 */
export async function syncProviderPlanChange(
  provider: PlanChangeProvider,
  input: { subscriptionId: string; previousAmount: string; amount: string; firstDueDate: string },
): Promise<void> {
  const targetCents = toCents(input.amount);
  const previousCents = toCents(input.previousAmount);
  if (targetCents <= 0 || previousCents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.firstDueDate)) {
    throw new PlanChangeError('Valor ou ciclo de destino inválido.', 'plan_change_target_invalid');
  }

  const subscription = await provider.getSubscription(input.subscriptionId);
  if (subscription.subscriptionId !== input.subscriptionId || subscription.status !== 'ACTIVE') {
    throw new PlanChangeError(
      'Assinatura não está ativa no Asaas.',
      'provider_subscription_not_active',
    );
  }
  if (
    toCents(subscription.value) !== previousCents &&
    toCents(subscription.value) !== targetCents
  ) {
    throw new PlanChangeError(
      'Valor recorrente diverge do contrato local.',
      'provider_subscription_unexpected_price',
    );
  }

  const payments = (await provider.listAllSubscriptionPayments(input.subscriptionId)).filter(
    (payment) => isTargetCycle(payment, input.subscriptionId, input.firstDueDate),
  );
  // Preflight completo antes do primeiro PUT: cobrança já paga pelo preço antigo
  // requer revisão humana. Alterá-la ou apagar o histórico financeiro seria falso.
  for (const payment of payments) {
    if (payment.deleted) continue;
    if (PAID_STATUSES.has(payment.status) && toCents(payment.value) === targetCents) continue;
    if (!EDITABLE_STATUSES.has(payment.status)) {
      throw new PlanChangeError(
        'Cobrança do novo ciclo já foi processada ou está em análise.',
        'provider_payment_not_editable',
      );
    }
    if (!isBillingType(payment.billingType)) {
      throw new PlanChangeError(
        'Meio de pagamento da cobrança não foi confirmado.',
        'provider_payment_invalid',
      );
    }
  }

  if (toCents(subscription.value) !== targetCents) {
    await provider.updateSubscription(input.subscriptionId, {
      value: targetCents / 100,
      updatePendingPayments: false,
    });
  }
  const updatedSubscription = await provider.getSubscription(input.subscriptionId);
  if (
    updatedSubscription.subscriptionId !== input.subscriptionId ||
    updatedSubscription.status !== 'ACTIVE' ||
    toCents(updatedSubscription.value) !== targetCents
  ) {
    throw new PlanChangeError(
      'Asaas não confirmou o novo valor recorrente.',
      'provider_subscription_mismatch',
    );
  }

  for (const listed of payments) {
    const current = await provider.getPayment(listed.paymentId);
    if (current.deleted) continue;
    if (
      !isTargetCycle(current, input.subscriptionId, input.firstDueDate) ||
      current.dueDate !== listed.dueDate
    ) {
      throw new PlanChangeError(
        'Cobrança mudou durante a troca de plano.',
        'provider_payment_changed',
      );
    }
    if (toCents(current.value) !== targetCents) {
      if (!EDITABLE_STATUSES.has(current.status) || !isBillingType(current.billingType)) {
        throw new PlanChangeError(
          'Cobrança deixou de ser editável durante a troca de plano.',
          'provider_payment_not_editable',
        );
      }
      await provider.updatePayment(current.paymentId, {
        value: targetCents / 100,
        billingType: current.billingType,
        dueDate: current.dueDate,
      });
    }
    const confirmed = await provider.getPayment(current.paymentId);
    if (
      confirmed.deleted ||
      confirmed.subscriptionId !== input.subscriptionId ||
      confirmed.dueDate !== listed.dueDate ||
      toCents(confirmed.value) !== targetCents
    ) {
      throw new PlanChangeError(
        'Asaas não confirmou o novo valor da cobrança.',
        'provider_payment_mismatch',
      );
    }
  }

  // Uma parcela pode ser emitida enquanto os PUTs estão em andamento. A segunda
  // listagem impede a aplicação local se ela nasceu com o valor antigo.
  const finalPayments = await provider.listAllSubscriptionPayments(input.subscriptionId);
  for (const payment of finalPayments) {
    if (
      !payment.deleted &&
      isTargetCycle(payment, input.subscriptionId, input.firstDueDate) &&
      toCents(payment.value) !== targetCents
    ) {
      throw new PlanChangeError(
        'Nova cobrança diverge do plano de destino.',
        'provider_payment_mismatch',
      );
    }
  }
}
