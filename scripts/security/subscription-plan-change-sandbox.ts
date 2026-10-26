/**
 * Prova remota isolada da troca de preço de assinatura. Não usa banco Qoro
 * nem clínicas existentes. Exige a chave e o host oficiais do Sandbox.
 */
import assert from 'node:assert/strict';

import { removeSubscriptionCharges } from '@/contexts/billing/internal/cancellation-charges';
import { addCalendarMonths } from '@/contexts/billing/internal/billing-period';
import { syncProviderBillingCycle } from '@/contexts/billing/internal/billing-cycle-provider-sync';
import { syncProviderPlanChange } from '@/contexts/billing/internal/plan-change-provider-sync';
import { asaasProvider } from '@/lib/payments/asaas';

const CONFIRM = 'ASAAS_SANDBOX_ONLY';
const TEST_CPF = '24971563792';
const MONTHLY_CLINIC_PRICE = 397;
const ANNUAL_CLINIC_PRICE = MONTHLY_CLINIC_PRICE * 10;
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
      expectedCycle: 'MONTHLY',
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
      expectedCycle: 'MONTHLY',
    });
    console.log('PASS: repetição de upgrade convergiu sem segunda cobrança');

    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '397.00',
      amount: '197.00',
      firstDueDate: dueDate,
      expectedCycle: 'MONTHLY',
    });
    assert.equal((await asaasProvider.getSubscription(subscriptionId)).value, 197);
    assert.ok(
      (await asaasProvider.listAllSubscriptionPayments(subscriptionId)).every(
        (payment) => payment.value === 197,
      ),
    );
    console.log(`PASS: downgrade ${method} alterou recorrência e parcela no Sandbox`);

    // A compra do terceiro médico usa a mesma recorrência da Clínica, sem
    // criar uma segunda assinatura. O delta mensal contratual é R$ 147.
    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '197.00',
      amount: '397.00',
      firstDueDate: dueDate,
      expectedCycle: 'MONTHLY',
    });
    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '397.00',
      amount: '544.00',
      firstDueDate: dueDate,
      expectedCycle: 'MONTHLY',
    });
    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '397.00',
      amount: '544.00',
      firstDueDate: dueDate,
      expectedCycle: 'MONTHLY',
    });
    assert.equal((await asaasProvider.getSubscription(subscriptionId)).value, 544);
    assert.ok(
      (await asaasProvider.listAllSubscriptionPayments(subscriptionId)).every(
        (payment) => payment.value === 544,
      ),
    );
    console.log(
      `PASS: médico adicional ${method} elevou a mesma recorrência para R$ 544 sem duplicata`,
    );

    await syncProviderPlanChange(asaasProvider, {
      subscriptionId,
      previousAmount: '544.00',
      amount: '397.00',
      firstDueDate: dueDate,
      expectedCycle: 'MONTHLY',
    });
    assert.equal((await asaasProvider.getSubscription(subscriptionId)).value, 397);
    assert.ok(
      (await asaasProvider.listAllSubscriptionPayments(subscriptionId)).every(
        (payment) => payment.value === 397,
      ),
    );
    console.log(`PASS: retirada do médico adicional ${method} reduziu a recorrência futura`);

    if (process.env.SANDBOX_CYCLE_PROBE === '1') {
      if (!subscriptionId) throw new Error('Assinatura Sandbox da fixture ausente');
      const cycleSubscriptionId = subscriptionId;
      const beforeCycle = await asaasProvider.getSubscription(subscriptionId);
      const beforePayments = await asaasProvider.listAllSubscriptionPayments(subscriptionId);
      await syncProviderBillingCycle(asaasProvider, {
        subscriptionId,
        previousAmount: String(MONTHLY_CLINIC_PRICE),
        amount: String(ANNUAL_CLINIC_PRICE),
        firstDueDate: dueDate,
        fromCycle: 'MONTHLY',
        toCycle: 'YEARLY',
      });
      const annual = await asaasProvider.getSubscription(subscriptionId);
      const annualPayments = await asaasProvider.listAllSubscriptionPayments(subscriptionId);
      console.log(
        `CYCLE_PROBE: nextDueDate ${beforeCycle.nextDueDate ?? 'absent'} -> ${annual.nextDueDate ?? 'absent'}; existing payments ${beforePayments.length} -> ${annualPayments.length}`,
      );
      assert.equal(annual.cycle, 'YEARLY');
      assert.equal(annual.value, ANNUAL_CLINIC_PRICE);
      assert.equal(annual.nextDueDate, addCalendarMonths(dueDate, 12));
      assert.equal(annualPayments.length, beforePayments.length, 'Ciclo criou cobrança duplicada');
      assert.ok(
        annualPayments.length > 0 &&
          annualPayments.every(
            (payment) => payment.value === ANNUAL_CLINIC_PRICE && payment.dueDate === dueDate,
          ),
        'Cobrança pendente anual não foi conciliada no Sandbox',
      );
      console.log(`PASS: mensal → anual ${method} atualizou recorrência e cobrança pendente`);

      if (process.env.SANDBOX_RENEWAL_PROBE === '1') {
        const renewalDueDate = addCalendarMonths(dueDate, 12);
        const [year, month] = renewalDueDate.split('-');
        const apiKey = process.env.ASAAS_API_KEY;
        assert.ok(apiKey, 'Chave do Sandbox ausente');
        const response = await fetch(
          `${process.env.ASAAS_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}/paymentBook?month=${Number(month)}&year=${Number(year)}`,
          {
            headers: {
              access_token: apiKey,
              accept: 'application/json',
            },
            signal: AbortSignal.timeout(30_000),
          },
        );
        const responseBody: unknown = await response.json().catch(() => null);
        const providerCode =
          responseBody &&
          typeof responseBody === 'object' &&
          'errors' in responseBody &&
          Array.isArray(responseBody.errors) &&
          responseBody.errors[0] &&
          typeof responseBody.errors[0] === 'object' &&
          'code' in responseBody.errors[0] &&
          typeof responseBody.errors[0].code === 'string'
            ? responseBody.errors[0].code
            : 'none';
        console.log(`RENEWAL_PROBE HTTP ${response.status} code=${providerCode}`);
        let renewedPayments = await asaasProvider.listAllSubscriptionPayments(subscriptionId);
        for (let attempt = 0; attempt < 10 && renewedPayments.length < 2; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          renewedPayments = await asaasProvider.listAllSubscriptionPayments(subscriptionId);
        }
        console.log(
          'RENEWAL_PROBE readback:',
          renewedPayments.map((payment) => ({ dueDate: payment.dueDate, value: payment.value })),
        );
        assert.equal(response.status, 200, 'Asaas recusou antecipar a renovação no Sandbox');
        assert.equal(renewedPayments.length, 2, 'Renovação gerou cobrança ausente ou duplicada');
        assert.deepEqual(
          renewedPayments.map((payment) => [payment.dueDate, payment.value]).sort(),
          [
            [dueDate, ANNUAL_CLINIC_PRICE],
            [renewalDueDate, ANNUAL_CLINIC_PRICE],
          ].sort(),
          'Valor ou vencimento da renovação anual divergente',
        );
        console.log(`PASS: renovação anual ${method} gerou uma única parcela futura no Sandbox`);
        return;
      }

      await assert.rejects(
        () =>
          syncProviderPlanChange(asaasProvider, {
            subscriptionId: cycleSubscriptionId,
            previousAmount: String(ANNUAL_CLINIC_PRICE),
            amount: String(MONTHLY_CLINIC_PRICE),
            firstDueDate: dueDate,
            expectedCycle: 'MONTHLY',
          }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'provider_subscription_unexpected_cycle',
      );
      const afterRejectedChange = await asaasProvider.getSubscription(subscriptionId);
      assert.equal(afterRejectedChange.cycle, 'YEARLY');
      assert.equal(afterRejectedChange.value, ANNUAL_CLINIC_PRICE);
      console.log('PASS: divergência de ciclo recusada sem alterar a assinatura anual');

      await syncProviderBillingCycle(asaasProvider, {
        subscriptionId,
        previousAmount: String(ANNUAL_CLINIC_PRICE),
        amount: String(MONTHLY_CLINIC_PRICE),
        firstDueDate: dueDate,
        fromCycle: 'YEARLY',
        toCycle: 'MONTHLY',
      });
      const monthly = await asaasProvider.getSubscription(subscriptionId);
      const monthlyPayments = await asaasProvider.listAllSubscriptionPayments(subscriptionId);
      assert.equal(monthly.cycle, 'MONTHLY');
      assert.equal(monthly.value, MONTHLY_CLINIC_PRICE);
      assert.ok(
        monthlyPayments.length > 0 &&
          monthlyPayments.every(
            (payment) => payment.value === MONTHLY_CLINIC_PRICE && payment.dueDate === dueDate,
          ),
        'Cobrança pendente mensal não foi restaurada no Sandbox',
      );
      console.log(`PASS: anual → mensal ${method} restaurou recorrência e cobrança pendente`);
    }
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
  console.error(
    '[sandbox plan change] FAIL:',
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error
        ? error.name
        : 'unknown',
  );
  process.exitCode = 1;
});
