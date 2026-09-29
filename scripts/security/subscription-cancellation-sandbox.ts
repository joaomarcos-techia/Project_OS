/**
 * Cancelamento de assinatura contra o SANDBOX do Asaas — o código real, ponta a ponta.
 *
 * Prova o que os testes de unidade só podem simular: que
 * `removeSubscriptionCharges` deixa uma assinatura sem NENHUMA cobrança viva no
 * Asaas de verdade — a da recorrência e a avulsa —, que repetir é seguro, e que
 * "Manter assinatura" religa a recorrência.
 *
 * Origem: em 28/09/2026 foi medido que `INACTIVE` (o único passo que o cancelamento
 * fazia) deixa a cobrança já gerada `PENDING`, e que o Asaas cria cada cobrança 40
 * dias antes do vencimento. O cliente que cancelava era cobrado mesmo assim.
 *
 * Uso:
 *   SANDBOX_CONFIRM=ASAAS_SANDBOX_ONLY \
 *   tsx --conditions=react-server scripts/security/subscription-cancellation-sandbox.ts
 *
 * Segurança: recusa rodar fora dos hosts HTTPS oficiais de sandbox, exige a
 * confirmação explícita acima, usa só boleto (nenhum dado de cartão) e o CPF de
 * teste que os outros scripts de sandbox já usam. Cria um cliente e uma
 * assinatura descartáveis e remove os dois no fim, inclusive em falha.
 */
import assert from 'node:assert/strict';

import { removeSubscriptionCharges } from '@/contexts/billing/internal/cancellation-charges';
import { asaasProvider } from '@/lib/payments/asaas';

const CONFIRM = 'ASAAS_SANDBOX_ONLY';
/** CPF de teste do sandbox (o mesmo de `asaas-live-check.ts`). Não é PII. */
const SANDBOX_TEST_CPF = '24971563792';

function guard(): void {
  if (process.env.SANDBOX_CONFIRM !== CONFIRM) {
    throw new Error(`[sandbox] exige SANDBOX_CONFIRM=${CONFIRM}`);
  }
  const parsed = new URL(process.env.ASAAS_BASE_URL ?? '');
  assert.ok(
    parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      ((parsed.hostname === 'sandbox.asaas.com' && parsed.pathname === '/api/v3') ||
        (parsed.hostname === 'api-sandbox.asaas.com' && parsed.pathname === '/v3')),
    '[sandbox] ASAAS_BASE_URL fora dos endpoints HTTPS oficiais de sandbox — abortado',
  );
  assert.ok(process.env.ASAAS_API_KEY, '[sandbox] ASAAS_API_KEY ausente');
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const results: Array<{ check: string; status: 'PASS' | 'FAIL'; detail: string }> = [];
function record(check: string, ok: boolean, detail: string): void {
  results.push({ check, status: ok ? 'PASS' : 'FAIL', detail });
}

async function main(): Promise<void> {
  guard();
  let customerId: string | null = null;
  let subscriptionId: string | null = null;

  try {
    customerId = (
      await asaasProvider.createCustomer({
        name: 'Sandbox Cancelamento Qoro',
        cpfCnpj: SANDBOX_TEST_CPF,
      })
    ).customerId;
    subscriptionId = (
      await asaasProvider.createSubscription({
        customerId,
        value: 149,
        cycle: 'MONTHLY',
        nextDueDate: inDays(10),
        description: 'sandbox: cancelamento',
        billingType: 'BOLETO',
        externalReference: `sandbox-cancel-${Date.now()}`,
      })
    ).subscriptionId;
    // A cobrança avulsa faz o papel do rateio de um upgrade aguardando pagamento:
    // ela NÃO pertence à recorrência e a listagem da assinatura não a enxerga.
    const avulsa = await asaasProvider.generateInvoice({
      customerId,
      value: 37.5,
      dueDate: inDays(3),
      description: 'sandbox: rateio de upgrade',
      billingType: 'BOLETO',
    });

    let daRecorrencia: string[] = [];
    for (let i = 0; i < 10 && daRecorrencia.length === 0; i++) {
      daRecorrencia = (await asaasProvider.listUnpaidSubscriptionPayments(subscriptionId)).map(
        (p) => p.paymentId,
      );
      if (daRecorrencia.length === 0) await new Promise((r) => setTimeout(r, 1_000));
    }
    record(
      '0 pré-condição: a recorrência já tem cobrança viva antes do cancelamento',
      daRecorrencia.length > 0,
      `${daRecorrencia.length} cobrança(s) em aberto`,
    );

    const removal = await removeSubscriptionCharges(asaasProvider, {
      asaasSubscriptionId: subscriptionId,
      extraPaymentIds: [avulsa.paymentId],
    });
    record(
      '1 removeSubscriptionCharges devolve ok',
      removal.ok,
      JSON.stringify({
        ok: removal.ok,
        removed: removal.removedPaymentIds.length,
        paid: removal.paidPaymentIds.length,
      }),
    );

    const sub = await asaasProvider.getSubscription(subscriptionId);
    record('2 recorrência pausada (INACTIVE)', sub.status === 'INACTIVE', `status=${sub.status}`);

    const restantes = await asaasProvider.listUnpaidSubscriptionPayments(subscriptionId);
    record(
      '3 nenhuma cobrança viva na recorrência',
      restantes.length === 0,
      `${restantes.length} restante(s)`,
    );

    const avulsaDepois = await asaasProvider.getPayment(avulsa.paymentId);
    record('4 cobrança avulsa apagada', avulsaDepois.deleted, `deleted=${avulsaDepois.deleted}`);

    const recorrenteDepois = await asaasProvider.getPayment(daRecorrencia[0]!);
    record(
      '5 cobrança da recorrência apagada (não só a assinatura pausada)',
      recorrenteDepois.deleted,
      `deleted=${recorrenteDepois.deleted} status=${recorrenteDepois.status}`,
    );

    const again = await removeSubscriptionCharges(asaasProvider, {
      asaasSubscriptionId: subscriptionId,
      extraPaymentIds: [avulsa.paymentId],
    });
    record(
      '6 repetir é seguro (idempotente)',
      again.ok && again.removedPaymentIds.length === 0,
      JSON.stringify({ ok: again.ok, removed: again.removedPaymentIds.length }),
    );

    await asaasProvider.updateSubscription(subscriptionId, {
      value: 149,
      status: 'ACTIVE',
      nextDueDate: inDays(10),
      updatePendingPayments: false,
    });
    const religada = await asaasProvider.getSubscription(subscriptionId);
    record(
      '7 "Manter assinatura" religa a recorrência',
      religada.status === 'ACTIVE',
      `status=${religada.status}`,
    );
  } finally {
    if (subscriptionId) {
      await asaasProvider.cancelSubscription(subscriptionId).catch(() => undefined);
      const residuo = await asaasProvider
        .listUnpaidSubscriptionPayments(subscriptionId)
        .catch(() => null);
      record(
        '8 limpeza: assinatura removida sem cobrança viva',
        residuo !== null && residuo.length === 0,
        residuo === null ? 'leitura falhou' : `${residuo.length} restante(s)`,
      );
    }
    if (customerId) await asaasProvider.deleteCustomer(customerId).catch(() => undefined);
  }

  for (const r of results) console.log(`${r.status}  ${r.check} — ${r.detail}`);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('[sandbox] falhou:', error instanceof Error ? error.message : 'desconhecido');
  process.exitCode = 1;
});
