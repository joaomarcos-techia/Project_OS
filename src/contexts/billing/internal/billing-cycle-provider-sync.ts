import type { PaymentProvider, ProviderPayment } from '@/lib/payments/asaas';

import { addCalendarMonths } from './billing-period';
import { toCents } from './money';
import { PlanChangeError } from './plan-changes';

type CycleProvider = Pick<
  PaymentProvider,
  | 'getSubscription'
  | 'updateSubscription'
  | 'listAllSubscriptionPayments'
  | 'getPayment'
  | 'updatePayment'
>;

const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const EDITABLE = new Set(['PENDING', 'OVERDUE']);

/**
 * Prepara a próxima parcela já emitida sem alterar uma dívida de ciclo anterior.
 * No Asaas, `nextDueDate` é a próxima parcela A EMITIR, não a que já está
 * pendente. Em uma troca mensal→anual, deixá-lo um mês adiante renovaria o
 * anual prematuramente; apontá-lo para a parcela existente arrisca duplicá-la.
 */
export async function syncProviderBillingCycle(
  provider: CycleProvider,
  input: {
    subscriptionId: string;
    previousAmount: string;
    amount: string;
    firstDueDate: string;
    fromCycle: 'MONTHLY' | 'YEARLY';
    toCycle: 'MONTHLY' | 'YEARLY';
  },
): Promise<void> {
  const oldCents = toCents(input.previousAmount);
  const targetCents = toCents(input.amount);
  if (
    oldCents <= 0 ||
    targetCents <= 0 ||
    input.fromCycle === input.toCycle ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.firstDueDate)
  ) {
    throw new PlanChangeError('Ciclo ou preço de destino inválido.', 'cycle_change_target_invalid');
  }

  const sub = await provider.getSubscription(input.subscriptionId);
  const allowedCycles: ReadonlySet<string> = new Set([input.fromCycle, input.toCycle]);
  if (
    sub.subscriptionId !== input.subscriptionId ||
    sub.status !== 'ACTIVE' ||
    sub.billingType !== 'CREDIT_CARD' ||
    sub.cycle === null ||
    !allowedCycles.has(sub.cycle) ||
    ![oldCents, targetCents].includes(toCents(sub.value))
  ) {
    throw new PlanChangeError(
      'Assinatura no Asaas não corresponde à troca.',
      'cycle_change_provider_mismatch',
    );
  }

  const payments = (await provider.listAllSubscriptionPayments(input.subscriptionId)).filter(
    (p) => !p.deleted && p.dueDate >= input.firstDueDate,
  );
  if (
    payments.length > 1 ||
    payments.some(
      (p) =>
        p.subscriptionId !== input.subscriptionId ||
        p.dueDate !== input.firstDueDate ||
        p.billingType !== 'CREDIT_CARD' ||
        (!EDITABLE.has(p.status) && !(PAID.has(p.status) && toCents(p.value) === targetCents)) ||
        (PAID.has(p.status) && toCents(p.value) !== targetCents),
    )
  ) {
    throw new PlanChangeError(
      'Cobrança futura já processada, duplicada ou divergente no Asaas.',
      'cycle_change_payment_conflict',
    );
  }

  const months = input.toCycle === 'YEARLY' ? 12 : 1;
  const nextDueDate = payments.length
    ? addCalendarMonths(input.firstDueDate, months)
    : input.firstDueDate;
  const previousNextDueDate = payments.length
    ? addCalendarMonths(input.firstDueDate, input.fromCycle === 'YEARLY' ? 12 : 1)
    : input.firstDueDate;
  if (
    sub.nextDueDate !== nextDueDate &&
    !(sub.cycle === input.fromCycle && sub.nextDueDate === previousNextDueDate)
  ) {
    throw new PlanChangeError(
      'Próximo vencimento do Asaas não corresponde ao ciclo local.',
      'cycle_change_due_date_mismatch',
    );
  }

  if (
    sub.cycle !== input.toCycle ||
    toCents(sub.value) !== targetCents ||
    sub.nextDueDate !== nextDueDate
  ) {
    await provider.updateSubscription(input.subscriptionId, {
      cycle: input.toCycle,
      value: targetCents / 100,
      nextDueDate,
      updatePendingPayments: false,
    });
  }
  const updated = await provider.getSubscription(input.subscriptionId);
  if (
    updated.subscriptionId !== input.subscriptionId ||
    updated.status !== 'ACTIVE' ||
    updated.billingType !== 'CREDIT_CARD' ||
    updated.cycle !== input.toCycle ||
    toCents(updated.value) !== targetCents ||
    updated.nextDueDate !== nextDueDate
  ) {
    throw new PlanChangeError(
      'Asaas não confirmou o novo ciclo.',
      'cycle_change_provider_mismatch',
    );
  }

  for (const listed of payments) {
    const current: ProviderPayment = await provider.getPayment(listed.paymentId);
    if (
      current.deleted ||
      current.subscriptionId !== input.subscriptionId ||
      current.dueDate !== input.firstDueDate ||
      current.billingType !== 'CREDIT_CARD'
    ) {
      throw new PlanChangeError('Cobrança mudou durante a troca.', 'cycle_change_payment_conflict');
    }
    if (toCents(current.value) !== targetCents) {
      if (!EDITABLE.has(current.status)) {
        throw new PlanChangeError('Cobrança já processada.', 'cycle_change_payment_conflict');
      }
      await provider.updatePayment(current.paymentId, {
        value: targetCents / 100,
        billingType: 'CREDIT_CARD',
        dueDate: current.dueDate,
      });
    }
  }

  const final = (await provider.listAllSubscriptionPayments(input.subscriptionId)).filter(
    (p) => !p.deleted && p.dueDate >= input.firstDueDate,
  );
  if (
    final.length !== payments.length ||
    final.some(
      (p) =>
        p.subscriptionId !== input.subscriptionId ||
        p.dueDate !== input.firstDueDate ||
        p.billingType !== 'CREDIT_CARD' ||
        toCents(p.value) !== targetCents,
    )
  ) {
    throw new PlanChangeError(
      'Cobrança futura não corresponde ao novo ciclo.',
      'cycle_change_payment_conflict',
    );
  }
}
