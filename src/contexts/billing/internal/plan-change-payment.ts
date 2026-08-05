/**
 * Efeito externo do upgrade. A solicitação já foi commitada antes de entrar
 * aqui; em caso de timeout, a busca por externalReference reconcilia a cobrança
 * antes de qualquer novo POST ao Asaas.
 */
import 'server-only';

import { withTenant } from '@/lib/db/tenant';

import { asaasProvider } from './providers/asaas';
import {
  getUpgradePaymentContext,
  linkUpgradePayment,
  planChangeExternalReference,
} from './plan-changes';

export type UpgradePaymentResult = {
  changeId: string;
  paymentId: string;
  paymentUrl: string | null;
  status: string;
};

export async function ensureUpgradePayment(
  clinicId: string,
  changeId: string,
): Promise<UpgradePaymentResult> {
  const context = await withTenant(clinicId, (tx) =>
    getUpgradePaymentContext(tx, clinicId, changeId),
  );
  if (context.providerPaymentId) {
    return {
      changeId,
      paymentId: context.providerPaymentId,
      paymentUrl: context.providerPaymentUrl,
      status: 'PENDING',
    };
  }

  const externalReference = planChangeExternalReference(changeId);
  let payment = await asaasProvider.findPaymentByExternalReference(externalReference, {
    attempts: 1,
  });
  if (!payment) {
    payment = await asaasProvider.generateInvoice({
      customerId: context.customerId,
      value: context.amountCents / 100,
      dueDate: context.dueDate,
      billingType: 'UNDEFINED',
      description: `Upgrade proporcional para o plano ${context.targetPlanName}`,
      externalReference,
    });
  }

  await withTenant(clinicId, (tx) => linkUpgradePayment(tx, clinicId, changeId, payment!));
  return {
    changeId,
    paymentId: payment.paymentId,
    paymentUrl: payment.invoiceUrl,
    status: payment.status,
  };
}
