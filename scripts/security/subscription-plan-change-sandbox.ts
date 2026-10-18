/**
 * Prova remota isolada da troca de preço de assinatura. Não usa banco Qoro
 * nem clínicas existentes. Exige a chave e o host oficiais do Sandbox.
 */
import assert from 'node:assert/strict';

import { removeSubscriptionCharges } from '@/contexts/billing/internal/cancellation-charges';
import { syncProviderPlanChange } from '@/contexts/billing/internal/plan-change-provider-sync';
import { asaasProvider } from '@/lib/payments/asaas';

const CONFIRM = 'ASAAS_SANDBOX_ONLY';
const TEST_CPF = '24971563792';
/** Cartão fictício aprovado fornecido pelo Sandbox; nunca pertence a um paciente. */
const SANDBOX_CARD = {
  holderName: 'Qoro Teste Sandbox',
  number: '4444444444444444',
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
} as const;

function guard(): void {
  assert.equal(process.env.SANDBOX_CONFIRM, CONFIRM, 'Confirmação explícita do Sandbox ausente');
  const url = new URL(process.env.ASAAS_BASE_URL ?? '');
  assert.ok(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ((url.hostname === 'sandbox.asaas.com' && url.pathname === '/api/v3') ||
        (url.hostname === 'api-sandbox.asaas.com' && url.pathname === '/v3')),
    'Endpoint não é o Asaas Sandbox oficial',
  );
  assert.ok(process.env.ASAAS_API_KEY, 'Chave do Sandbox ausente');
}

async function main(): Promise<void> {
  guard();
  const dueDate = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const method = process.env.SANDBOX_PLAN_CHANGE_METHOD ?? 'BOLETO';
  assert.ok(
    method === 'BOLETO' || method === 'PIX' || method === 'CREDIT_CARD',
    'Método de teste inválido',
  );
  const card = method === 'CREDIT_CARD';
  let customerId: string | null = null;
  let subscriptionId: string | null = null;
  try {
    customerId = (
      await asaasProvider.createCustomer({
        name: 'Qoro Sandbox Troca de Plano',
        email: 'qoro-sandbox@example.test',
        cpfCnpj: TEST_CPF,
        phone: '11999990000',
      })
    ).customerId;
    const subscriptionInput = {
      customerId,
      value: 197,
      cycle: 'MONTHLY' as const,
      nextDueDate: dueDate,
      description: 'Teste isolado de troca de plano',
      externalReference: `qoro-plan-change-test-${Date.now()}`,
    };
    subscriptionId = card
      ? (
          await asaasProvider.createSubscriptionWithCard({
            ...subscriptionInput,
            creditCard: SANDBOX_CARD,
            holderInfo: {
              name: SANDBOX_CARD.holderName,
              email: 'qoro-sandbox@example.test',
              cpfCnpj: TEST_CPF,
              postalCode: '89223005',
              addressNumber: '277',
              phone: '11999990000',
            },
            remoteIp: '203.0.113.10',
          })
        ).subscriptionId
      : (await asaasProvider.createSubscription({ ...subscriptionInput, billingType: method }))
          .subscriptionId;

    let payments = await asaasProvider.listAllSubscriptionPayments(subscriptionId);
    for (let attempt = 0; attempt < 10 && payments.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      payments = await asaasProvider.listAllSubscriptionPayments(subscriptionId);
    }
    assert.ok(payments.length > 0, 'Asaas não emitiu parcela de teste');
    assert.ok(
      payments.some((payment) => payment.dueDate === dueDate),
      'Parcela esperada ausente',
    );

    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '197.00',
      amount: '397.00',
      firstDueDate: dueDate,
    });
    assert.equal((await asaasProvider.getSubscription(subscriptionId)).value, 397);
    assert.ok(
      (await asaasProvider.listAllSubscriptionPayments(subscriptionId)).every(
        (payment) => payment.value === 397,
      ),
    );
    console.log(`PASS: upgrade ${method} alterou recorrência e parcela no Sandbox`);

    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '197.00',
      amount: '397.00',
      firstDueDate: dueDate,
    });
    console.log('PASS: repetição de upgrade convergiu sem segunda cobrança');

    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '397.00',
      amount: '197.00',
      firstDueDate: dueDate,
    });
    assert.equal((await asaasProvider.getSubscription(subscriptionId)).value, 197);
    assert.ok(
      (await asaasProvider.listAllSubscriptionPayments(subscriptionId)).every(
        (payment) => payment.value === 197,
      ),
    );
    console.log(`PASS: downgrade ${method} alterou recorrência e parcela no Sandbox`);
  } finally {
    let cleanupError: unknown = null;
    if (subscriptionId) {
      try {
        const cleanup = await removeSubscriptionCharges(asaasProvider, {
          asaasSubscriptionId: subscriptionId,
          extraPaymentIds: [],
        });
        assert.ok(cleanup.ok, 'Cleanup da assinatura não foi confirmado');
        assert.equal(
          (await asaasProvider.listUnpaidSubscriptionPayments(subscriptionId)).length,
          0,
        );
      } catch (error) {
        cleanupError = error;
      }
      try {
        await asaasProvider.cancelSubscription(subscriptionId);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (customerId) {
      try {
        await asaasProvider.deleteCustomer(customerId);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) throw cleanupError;
    console.log('PASS: recursos de teste criados no Sandbox foram removidos e conferidos');
  }
}

main().catch((error: unknown) => {
  console.error('[sandbox plan change] FAIL:', error instanceof Error ? error.name : 'unknown');
  process.exitCode = 1;
});
