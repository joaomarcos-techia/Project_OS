/**
 * Parar de cobrar uma clínica que cancelou — no Asaas, e com prova.
 *
 * ===================================================================
 * O defeito que este módulo fecha (medido em 28/09/2026)
 * ===================================================================
 * O cancelamento só punha a assinatura em `INACTIVE`, e só no dia em que ele
 * entrava em vigor. `INACTIVE` impede o Asaas de gerar cobranças NOVAS, mas —
 * palavras da documentação oficial — "as cobranças já existentes permanecem
 * inalteradas". Medido no sandbox: depois do `INACTIVE` a cobrança continuou
 * `PENDING`. E o Asaas cria cada cobrança 40 dias antes do vencimento, então a
 * parcela do mês seguinte já existia (vencendo exatamente no dia do
 * cancelamento), e com cartão cadastrado ela era cobrada.
 *
 * ===================================================================
 * O que este módulo garante
 * ===================================================================
 * 1. a recorrência é pausada ANTES de apagar — senão o Asaas poderia gerar uma
 *    cobrança nova entre a listagem e o fim da varredura;
 * 2. toda cobrança ainda não paga é apagada (`DELETE /payments/{id}`) — as da
 *    assinatura, em todas as páginas, e as avulsas que o sistema conhece
 *    (upgrade proporcional, invoice local em aberto);
 * 3. a resposta só é `ok` depois de uma RELEITURA provar que não sobrou
 *    cobrança viva. Sem releitura, "apagamos" seria só o que pedimos.
 *
 * A recorrência fica `INACTIVE`, não é removida: é o que permite reativar sem
 * pedir o cartão de novo (a decisão já existia no cron e continua valendo).
 *
 * ===================================================================
 * Por que é seguro repetir
 * ===================================================================
 * Cada passo é idempotente no Asaas: pausar o que já está pausado, apagar o que
 * já sumiu (404 ou `deleted: true` contam como feito). Uma falha no meio deixa
 * a operação pela metade do lado de lá, e a próxima tentativa termina o
 * trabalho. Quem chama não grava nada localmente enquanto isto não voltar `ok`.
 */
import {
  BillingProviderError,
  type PaymentProvider,
  type ProviderPayment,
} from '@/lib/payments/asaas';
import { metrics } from '@/lib/observability/metrics';

type ChargeProvider = Pick<
  PaymentProvider,
  'updateSubscription' | 'listUnpaidSubscriptionPayments' | 'getPayment' | 'cancelPayment'
>;

/** Ainda não pago e o Asaas aceita apagar. */
const DELETABLE = new Set(['PENDING', 'OVERDUE']);
/** Cartão em análise antifraude: não dá para apagar, e pode virar cobrança. */
const IN_FLIGHT = new Set(['AWAITING_RISK_ANALYSIS']);
/** Já virou dinheiro. Não é "sobra" — é algo que alguém precisa olhar. */
const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

export type ChargeRemovalResult =
  | {
      ok: true;
      /** Cobranças cuja ausência foi confirmada, inclusive após resposta perdida/retry. */
      removedPaymentIds: string[];
      /**
       * Cobranças que eram candidatas e JÁ ESTAVAM pagas — em geral um cartão
       * processado no mesmo instante do cancelamento. O cancelamento segue, mas
       * o dinheiro entrou: é caso de estorno manual, e por isso sai daqui.
       */
      paidPaymentIds: string[];
    }
  | {
      ok: false;
      /**
       * `in_flight`: há cobrança de cartão em análise, que o Asaas não deixa
       *  apagar — tentar de novo em alguns minutos.
       * `provider_unavailable`: o Asaas não respondeu de forma conclusiva, ou a
       *  releitura ainda viu cobrança viva.
       */
      reason: 'in_flight' | 'provider_unavailable';
      removedPaymentIds: string[];
      paidPaymentIds: string[];
    };

function isNotFound(error: unknown): boolean {
  return error instanceof BillingProviderError && error.httpStatus === 404;
}

type Estado = 'gone' | 'deletable' | 'in_flight' | 'paid' | 'other';

function classify(payment: Pick<ProviderPayment, 'status' | 'deleted'>): Estado {
  if (payment.deleted) return 'gone';
  if (DELETABLE.has(payment.status)) return 'deletable';
  if (IN_FLIGHT.has(payment.status)) return 'in_flight';
  if (PAID.has(payment.status)) return 'paid';
  return 'other';
}

async function readState(provider: ChargeProvider, paymentId: string): Promise<Estado> {
  try {
    return classify(await provider.getPayment(paymentId, { attempts: 2 }));
  } catch (error) {
    if (isNotFound(error)) return 'gone';
    throw error;
  }
}

/**
 * Pausa a recorrência e apaga toda cobrança ainda não paga.
 *
 * `extraPaymentIds` são cobranças que NÃO pertencem à recorrência mas o sistema
 * conhece: o rateio de um upgrade aguardando pagamento e invoices locais em
 * aberto. Sem elas, "apagar todas as cobranças" deixaria de fora exatamente as
 * que o próprio Qoro criou.
 */
export async function removeSubscriptionCharges(
  provider: ChargeProvider,
  input: { asaasSubscriptionId: string | null; extraPaymentIds: readonly string[] },
): Promise<ChargeRemovalResult> {
  const removedPaymentIds: string[] = [];
  const paidPaymentIds: string[] = [];
  const fail = (reason: 'in_flight' | 'provider_unavailable'): ChargeRemovalResult => {
    metrics.emit('billing.cancellation.charges_incomplete', {
      reason,
      removed: removedPaymentIds.length,
    });
    return { ok: false, reason, removedPaymentIds, paidPaymentIds };
  };

  try {
    // 1. Pausar primeiro. Apagar antes deixaria uma janela em que o Asaas gera
    //    a próxima cobrança depois da varredura.
    if (input.asaasSubscriptionId) {
      await provider.updateSubscription(input.asaasSubscriptionId, {
        status: 'INACTIVE',
        updatePendingPayments: false,
      });
    }

    // 2. Candidatas: a recorrência (todas as páginas) + as avulsas conhecidas.
    const candidatas = new Map<string, Estado | null>();
    if (input.asaasSubscriptionId) {
      for (const payment of await provider.listUnpaidSubscriptionPayments(
        input.asaasSubscriptionId,
      )) {
        candidatas.set(payment.paymentId, classify(payment));
      }
    }
    for (const id of input.extraPaymentIds) {
      if (!candidatas.has(id)) candidatas.set(id, null);
    }

    // 3. Apagar o que ainda pode virar dinheiro.
    let emAnalise = false;
    for (const [paymentId, listado] of candidatas) {
      const estado = listado ?? (await readState(provider, paymentId));
      if (estado === 'in_flight') {
        emAnalise = true;
        continue;
      }
      if (estado === 'paid') {
        paidPaymentIds.push(paymentId);
        continue;
      }
      // Reconcile a known local invoice even when an earlier DELETE response
      // or webhook was lost. The authoritative read already proved absence.
      if (estado === 'gone') {
        removedPaymentIds.push(paymentId);
        continue;
      }
      if (estado !== 'deletable') continue;
      try {
        await provider.cancelPayment(paymentId);
        removedPaymentIds.push(paymentId);
      } catch (error) {
        if (isNotFound(error)) {
          removedPaymentIds.push(paymentId);
          continue;
        }
        // O DELETE falhou. O motivo mais provável é o cartão ter sido
        // processado no meio do caminho — reler decide, não o palpite.
        const depois = await readState(provider, paymentId);
        if (depois === 'paid') paidPaymentIds.push(paymentId);
        else if (depois === 'in_flight') emAnalise = true;
        else if (depois === 'gone') removedPaymentIds.push(paymentId);
        else return fail('provider_unavailable');
      }
    }
    if (emAnalise) return fail('in_flight');

    // 4. Releitura. Só ela autoriza dizer que não sobrou nada.
    if (input.asaasSubscriptionId) {
      const restantes = await provider.listUnpaidSubscriptionPayments(input.asaasSubscriptionId);
      if (restantes.some((p) => classify(p) === 'in_flight')) return fail('in_flight');
      if (restantes.some((p) => classify(p) === 'deletable')) return fail('provider_unavailable');
    }
    for (const paymentId of removedPaymentIds) {
      if (candidatas.get(paymentId) !== null) continue; // já coberta pela listagem acima
      const estado = await readState(provider, paymentId);
      if (estado === 'deletable') return fail('provider_unavailable');
      if (estado === 'in_flight') return fail('in_flight');
    }
  } catch {
    return fail('provider_unavailable');
  }

  if (paidPaymentIds.length > 0) {
    metrics.emit('billing.cancellation.paid_during_cancellation', {
      count: paidPaymentIds.length,
    });
  }
  metrics.emit('billing.cancellation.charges_removed', { count: removedPaymentIds.length });
  return { ok: true, removedPaymentIds, paidPaymentIds };
}
