/**
 * O-5 — orquestração da assinatura recorrente do cadastro autônomo. SERVER-ONLY.
 *
 * Ordem, e o porquê de cada passo estar onde está:
 *
 *   1. reserva no banco (CAS)        — antes de qualquer I/O, para que timeout
 *                                       nunca deixe o sistema sem saber que tentou;
 *   2. procura por `externalReference` — barato, e resolve o caso em que uma
 *                                       tentativa anterior criou do outro lado;
 *   3. cria customer + assinatura     — SEM cartão. O Asaas emite as faturas e
 *                                       hospeda o pagamento; o Qoro não coleta meio;
 *   4. readback `getSubscription`     — o §21.20 exige assinatura recorrente
 *                                       CONFIRMADA no servidor antes do trial;
 *   5. ativa por CAS                  — se perder, cancela a assinatura órfã.
 *
 * O browser não participa de nenhum desses passos. Ele não manda plano, valor,
 * ciclo, trial nem status; o callback dele não ativa nada. A única coisa que o
 * browser faz é pedir "comece" e depois ler o estado.
 */
import 'server-only';

/* eslint-disable boundaries/element-types -- O cadastro legado precisa reconhecer o catálogo novo antes de chamar o provedor. */
import { isOffer2026PlanCode } from '@/contexts/billing/proposed-offer';
/* eslint-enable boundaries/element-types */
import {
  asaasProvider,
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
  type PaymentProvider,
} from '@/lib/payments/asaas';
import { metrics } from '@/lib/observability/metrics';

import {
  activateSignupBillingAttempt,
  centsToReais,
  markSignupBillingIssue,
  readSignupBillingReconcileTarget,
  reconcileSignupBillingAttempt,
  reserveSignupBillingAttempt,
  type SignupBillingIntent,
} from './signup-billing';

export type StartSignupSubscriptionOutcome =
  | { ok: true; state: 'active'; subscriptionId: string }
  | {
      ok: false;
      reason:
        | 'gone'
        | 'no_plan'
        | 'invalid_plan'
        | 'conflict'
        | 'already_active'
        | 'checkout_pending'
        | 'reconcile_required'
        | 'declined'
        | 'provider_unreachable'
        | 'unavailable';
    };

/**
 * Código curto e nosso. O corpo de um 4xx do gateway pode refletir o request e
 * por isso NUNCA é persistido, logado nem exibido — só esta etiqueta.
 */
function failureCodeOf(error: BillingProviderError): string {
  const raw = error.providerErrorCodes[0] ?? error.code ?? 'provider_rejected';
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/gu, '_')
    .slice(0, 64);
  return normalized.length > 0 ? normalized : 'provider_rejected';
}

/** Compensação de customer criado nesta tentativa e não aproveitado. */
async function compensateCustomer(client: PaymentProvider, customerId: string): Promise<void> {
  try {
    await client.deleteCustomer(customerId);
    metrics.emit('signup.billing.customer_compensated', { outcome: 'deleted' });
  } catch (error) {
    // A falha da compensação não pode mascarar o erro real do checkout. Vira
    // métrica sanitizada para conciliação humana — sem dado de pagamento.
    metrics.emit('signup.billing.customer_compensation_failed', { error });
  }
}

/** Cancela assinatura que existe do lado do provedor e que não conseguimos ativar. */
async function compensateSubscription(client: PaymentProvider, id: string): Promise<void> {
  try {
    await client.cancelSubscription(id);
    metrics.emit('signup.billing.subscription_compensated', { outcome: 'cancelled' });
  } catch (error) {
    metrics.emit('signup.billing.subscription_compensation_failed', { error });
  }
}

function describe(intent: SignupBillingIntent): string {
  return `Qoro · plano ${intent.planCode} — ${intent.clinicName}`;
}

/**
 * Confere que a assinatura do provedor é a que pedimos, antes de tratá-la como
 * boa. Um `id` devolvido não prova valor nem estado corretos, e o trial começa a
 * partir DESTA confirmação, não do HTTP 200.
 */
function subscriptionMatchesIntent(
  subscription: { status: string; value: number },
  intent: Pick<SignupBillingIntent, 'priceCents'>,
): boolean {
  if (subscription.status !== 'ACTIVE') return false;
  return Math.round(subscription.value * 100) === intent.priceCents;
}

export async function startSignupSubscription(input: {
  userId: string;
  verifiedEmail: string;
  /**
   * CPF/CNPJ do responsável pela cobrança, JÁ validado na borda.
   *
   * Chega por requisição e não é persistido antes do tenant existir: o Asaas
   * exige documento para assinar (medido no sandbox — ADR-053), e guardá-lo em
   * `signup_sessions` colocaria PII sensível numa tabela pré-tenant, sem chave
   * de tenant para cifrá-la. Ele descansa cifrado em `billing_customers`, no
   * provisionamento, e só lá.
   */
  cpfCnpj: string;
  client?: PaymentProvider;
}): Promise<StartSignupSubscriptionOutcome> {
  const client = input.client ?? asaasProvider;

  const reserved = await reserveSignupBillingAttempt(input.userId);
  if (!reserved.ok) return { ok: false, reason: reserved.reason };

  const { intent, rowVersion } = reserved;
  // O contrato 2026 só pode seguir pelo Checkout hospedado, que fixa cartão
  // e valida o ciclo anual no readback. Esta rotina é compatibilidade legada.
  if (isOffer2026PlanCode(intent.planCode)) {
    await markSignupBillingIssue({
      userId: input.userId,
      reservedVersion: rowVersion,
      outcome: 'failed',
      failureCode: 'legacy_checkout_unsupported',
    });
    return { ok: false, reason: 'invalid_plan' };
  }
  let customerId: string | null = null;
  let customerCreatedHere: string | null = null;
  let subscriptionId: string;

  try {
    // Uma tentativa anterior pode ter criado do outro lado antes de o socket
    // cair. Procurar é barato e evita a segunda assinatura.
    const existing = await client.findSubscriptionByExternalReference(intent.externalReference);
    if (existing?.customerId) {
      customerId = existing.customerId;
      subscriptionId = existing.subscriptionId;
    } else {
      // O documento vai junto porque o contrato do Asaas EXIGE: sem `cpfCnpj`,
      // `POST /subscriptions` devolve `400 invalid_object`, com ou sem
      // `billingType` definido. Medido no sandbox em 18/09 (ADR-053).
      const created = await client.createCustomer({
        name: intent.ownerName,
        email: input.verifiedEmail,
        cpfCnpj: input.cpfCnpj,
      });
      customerId = created.customerId;
      customerCreatedHere = created.customerId;

      const subscription = await client.createSubscription({
        customerId,
        value: centsToReais(intent.priceCents),
        cycle: 'MONTHLY',
        // Primeira cobrança vence ao FIM do trial. Ela não precisa estar
        // liquidada para o trial começar (decisão de 02/09, §21.20).
        nextDueDate: intent.nextDueDate,
        description: describe(intent),
        // UNDEFINED deixa o pagador escolher PIX/boleto/cartão na página do
        // Asaas. É o que mantém "Checkout hospedado" sem o Qoro ver o meio.
        billingType: 'UNDEFINED',
        externalReference: intent.externalReference,
      });
      subscriptionId = subscription.subscriptionId;
    }

    // Readback autoritativo: valor e estado vêm do provedor, não da nossa
    // expectativa nem do browser.
    const readback = await client.getSubscription(subscriptionId);
    if (!subscriptionMatchesIntent(readback, intent)) {
      await compensateSubscription(client, subscriptionId);
      if (customerCreatedHere) await compensateCustomer(client, customerCreatedHere);
      await markSignupBillingIssue({
        userId: input.userId,
        reservedVersion: rowVersion,
        outcome: 'failed',
        failureCode: 'subscription_readback_mismatch',
      });
      return { ok: false, reason: 'declined' };
    }
  } catch (error) {
    if (error instanceof BillingProviderError) {
      // 4xx é definitivo: nada foi criado. Compensa só o que esta tentativa criou
      // e deixa o estado retentável.
      if (customerCreatedHere) await compensateCustomer(client, customerCreatedHere);
      await markSignupBillingIssue({
        userId: input.userId,
        reservedVersion: rowVersion,
        outcome: 'failed',
        failureCode: failureCodeOf(error),
      });
      return { ok: false, reason: 'declined' };
    }
    if (
      error instanceof BillingProviderUnreachableError ||
      error instanceof BillingCircuitOpenError
    ) {
      // Indeterminado. NÃO compensa (apagar um customer cuja assinatura talvez
      // exista é pior) e NÃO deixa retentável: só reconciliação sai daqui.
      await markSignupBillingIssue({
        userId: input.userId,
        reservedVersion: rowVersion,
        outcome: 'creation_unknown',
        failureCode: 'subscription_creation_unknown',
        asaasCustomerId: customerId,
      });
      return { ok: false, reason: 'provider_unreachable' };
    }
    throw error;
  }

  const activated = await activateSignupBillingAttempt({
    userId: input.userId,
    reservedVersion: rowVersion,
    asaasCustomerId: customerId,
    asaasSubscriptionId: subscriptionId,
  });
  if (!activated.ok) {
    // Perdemos o CAS: outra aba/processo mexeu na linha. A assinatura existe e
    // não tem dono local — cancela, em vez de deixar cobrança órfã.
    await compensateSubscription(client, subscriptionId);
    if (customerCreatedHere) await compensateCustomer(client, customerCreatedHere);
    return { ok: false, reason: 'conflict' };
  }

  metrics.emit('signup.billing.subscription_active', { planCode: intent.planCode });
  return { ok: true, state: 'active', subscriptionId };
}

export type ReconcileSignupSubscriptionOutcome =
  | { ok: true; state: 'active' | 'not_found' }
  | { ok: false; reason: 'gone' | 'conflict' | 'provider_unreachable' | 'unavailable' };

/**
 * Única saída de `creation_unknown`.
 *
 * Não cria nada: pergunta ao provedor, pelo `externalReference`, se a assinatura
 * que o timeout escondeu existe. Se existe, registra. Se não existe, o estado
 * continua `creation_unknown` — quem decide liberar nova tentativa é a operação,
 * com o runbook, não um retry automático.
 */
export async function reconcileSignupSubscription(input: {
  userId: string;
  client?: PaymentProvider;
}): Promise<ReconcileSignupSubscriptionOutcome> {
  const client = input.client ?? asaasProvider;

  const target = await readSignupBillingReconcileTarget(input.userId);
  if (!target) return { ok: false, reason: 'gone' };
  // Uma tentativa do Checkout hospedado 2026 não é uma assinatura legada.
  // Promovê-la aqui poderia provisionar sem conferir ciclo e pagamento.
  if (isOffer2026PlanCode(target.planCode)) return { ok: false, reason: 'conflict' };

  let found: Awaited<ReturnType<PaymentProvider['findSubscriptionByExternalReference']>>;
  try {
    found = await client.findSubscriptionByExternalReference(target.externalReference);
    if (found?.customerId) {
      const readback = await client.getSubscription(found.subscriptionId);
      if (
        !subscriptionMatchesIntent(readback, target) ||
        readback.subscriptionId !== found.subscriptionId ||
        readback.externalReference !== target.externalReference ||
        readback.customerId !== found.customerId ||
        (target.asaasCustomerId !== null && readback.customerId !== target.asaasCustomerId)
      ) {
        // Mantém creation_unknown: não provisiona, não cria outra assinatura
        // e não apaga um customer cuja correlação não foi confirmada.
        metrics.emit('signup.billing.reconcile_mismatch', {});
        return { ok: false, reason: 'conflict' };
      }
    }
  } catch (error) {
    if (
      error instanceof BillingProviderUnreachableError ||
      error instanceof BillingCircuitOpenError
    ) {
      return { ok: false, reason: 'provider_unreachable' };
    }
    throw error;
  }

  if (!found?.customerId) {
    metrics.emit('signup.billing.reconcile_not_found', {});
    return { ok: true, state: 'not_found' };
  }

  const settled = await reconcileSignupBillingAttempt({
    userId: input.userId,
    expectedVersion: target.rowVersion,
    asaasCustomerId: found.customerId,
    asaasSubscriptionId: found.subscriptionId,
  });
  if (!settled.ok) return { ok: false, reason: 'conflict' };

  metrics.emit('signup.billing.reconciled', {});
  return { ok: true, state: 'active' };
}
