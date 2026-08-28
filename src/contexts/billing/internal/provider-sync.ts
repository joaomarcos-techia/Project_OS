/**
 * BILLING-002 — reconciliação da invoice local com o estado do Asaas.
 *
 * `ensureInvoiceForPayment()` retorna imediatamente quando encontra uma invoice
 * existente, sem olhar `due_date`, `total_amount` nem remoção. Uma edição no
 * painel do Asaas podia ficar divergente do ClinicaOS indefinidamente, e uma
 * cobrança EXCLUÍDA continuava `open` local — com o dunning cobrando algo que
 * não existe mais.
 *
 * Decisão pura, separada do I/O: recebe o estado local e o do provedor e devolve
 * o que fazer. É o que torna testável a parte difícil — quando NÃO agir.
 *
 * Três invariantes:
 *   1. TERMINAL não regride. `paid`/`cancelled` são fim de linha; um
 *      `PAYMENT_UPDATED` atrasado não reabre cobrança quitada.
 *   2. DELETE é fail-closed. O corpo do webhook é autenticado só por token
 *      estático e não prova remoção; sem confirmação autoritativa a invoice vai
 *      para REVISÃO, não para `cancelled`. Delete NUNCA vira refund.
 *   3. Divergência de VALOR não se auto-aplica em silêncio junto com a data:
 *      mudar quanto o cliente deve é decisão de cobrança, e fica registrada.
 */

import type { InvoiceStatus } from './state-machine';

/** Estados em que a invoice ainda é editável pelo provedor. */
const MUTABLE: ReadonlySet<InvoiceStatus> = new Set<InvoiceStatus>(['open', 'overdue', 'partial']);

export interface LocalInvoiceState {
  status: InvoiceStatus;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  /** Em centavos — comparação de dinheiro nunca em float. */
  totalCents: number;
}

export interface ProviderInvoiceState {
  /** `null` = o provedor não tem mais esse pagamento (404 na consulta). */
  exists: boolean;
  /** `YYYY-MM-DD`; ausente quando não foi possível ler. */
  dueDate?: string | null;
  totalCents?: number | null;
  /** Status bruto do Asaas, já traduzido pelo caller para o vocabulário local. */
  status?: InvoiceStatus | null;
}

export type ProviderSyncAction =
  /** Nada a fazer — local e provedor concordam, ou o local é terminal. */
  | { kind: 'noop'; reason: string }
  /** Atualiza data e/ou valor da invoice ainda aberta. */
  | {
      kind: 'update';
      dueDate?: string;
      totalCents?: number;
      /** `true` quando o VALOR mudou — exige registro explícito. */
      amountChanged: boolean;
    }
  /** O provedor confirma um estado terminal que o local ainda não tem. */
  | { kind: 'terminalize'; status: InvoiceStatus }
  /**
   * Uma cobrança antes removida voltou a existir no provedor. A invoice abre
   * primeiro; o caller ainda aplica `paid`/`overdue` pelo caminho único já
   * existente quando esse for o estado autoritativo atual.
   */
  | {
      kind: 'restore';
      status: 'open';
      dueDate?: string;
      totalCents?: number;
      amountChanged: boolean;
    }
  /** Sem confirmação autoritativa: marca para revisão humana, não decide. */
  | { kind: 'flag_divergence'; reason: string };

function restorableProviderStatus(status: InvoiceStatus | null | undefined): boolean {
  return status === 'open' || status === 'overdue' || status === 'paid';
}

/**
 * Decide a reconciliação. `providerConfirmedMissing` distingue "o GET devolveu
 * 404 e sabemos que sumiu" de "não conseguimos confirmar" — é a diferença entre
 * cancelar uma cobrança e inventar que ela sumiu.
 */
export function decideProviderSync(
  local: LocalInvoiceState,
  provider: ProviderInvoiceState,
  opts: { providerConfirmedMissing: boolean } = { providerConfirmedMissing: false },
): ProviderSyncAction {
  // 1. A única exceção ao terminal `cancelled`: a MESMA cobrança voltou a
  // existir no getPayment autoritativo. Não depende do rótulo do webhook — ele
  // é só notificação — e não aceita estado desconhecido/refunded. Restauramos
  // primeiro para `open`; o caller aplica paid/overdue pelo caminho único.
  if (
    local.status === 'cancelled' &&
    provider.exists &&
    restorableProviderStatus(provider.status)
  ) {
    const dueChanged = typeof provider.dueDate === 'string' && provider.dueDate !== local.dueDate;
    const amountChanged =
      typeof provider.totalCents === 'number' && provider.totalCents !== local.totalCents;
    return {
      kind: 'restore',
      status: 'open',
      ...(dueChanged ? { dueDate: provider.dueDate as string } : {}),
      ...(amountChanged ? { totalCents: provider.totalCents as number } : {}),
      amountChanged,
    };
  }

  // 2. Outros terminais locais vencem sempre. Um evento atrasado não regride.
  if (!MUTABLE.has(local.status)) {
    return { kind: 'noop', reason: `local_terminal:${local.status}` };
  }

  // 3. Pagamento sumiu do provedor.
  if (!provider.exists) {
    if (!opts.providerConfirmedMissing) {
      // O corpo do webhook não é prova. Sem o 404 do GET autoritativo, não se
      // cancela cobrança de ninguém com base numa notificação.
      return { kind: 'flag_divergence', reason: 'provider_missing_unconfirmed' };
    }
    return { kind: 'terminalize', status: 'cancelled' };
  }

  // 4. O provedor já está num estado terminal que o local não alcançou.
  if (provider.status && !MUTABLE.has(provider.status)) {
    return { kind: 'terminalize', status: provider.status };
  }

  // 5. Divergência de data/valor numa invoice ainda aberta.
  const dueChanged = typeof provider.dueDate === 'string' && provider.dueDate !== local.dueDate;
  const amountChanged =
    typeof provider.totalCents === 'number' && provider.totalCents !== local.totalCents;

  if (!dueChanged && !amountChanged) return { kind: 'noop', reason: 'in_sync' };

  return {
    kind: 'update',
    ...(dueChanged ? { dueDate: provider.dueDate as string } : {}),
    ...(amountChanged ? { totalCents: provider.totalCents as number } : {}),
    amountChanged,
  };
}

/** Traduz o status bruto do Asaas para o vocabulário local de invoice. */
export function providerStatusToInvoiceStatus(status: string): InvoiceStatus | null {
  if (status === 'RECEIVED' || status === 'CONFIRMED' || status === 'RECEIVED_IN_CASH') {
    return 'paid';
  }
  if (status === 'OVERDUE') return 'overdue';
  // REFUNDED não é status de invoice: o estorno vive em payment_attempts e a
  // invoice permanece `paid` (contrato existente de markInvoiceRefunded).
  if (status === 'PENDING' || status === 'AWAITING_RISK_ANALYSIS') return 'open';
  return null;
}
