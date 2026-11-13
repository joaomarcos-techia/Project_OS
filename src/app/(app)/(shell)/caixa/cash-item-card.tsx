'use client';

import type {
  CaixaItem,
  PaymentMethodDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import { Button } from '@/components/ui/button';
import { PaymentStatusBadge } from '@/components/ui/status-badge';
import { formatBRL, QORO_DATE_TIME_ZONE, todayYmdIn } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import {
  CancelPaymentPanel,
  canMarkPaidInCash,
  cashActionLabel,
  ConfirmPaymentPanel,
  RefundPaymentPanel,
  type RefundInput,
} from './cash-action-panels';
import { outstandingBalance } from './caixa-money';
import type { CashPanelMode } from './caixa-types';
import { PayoutReviewForm } from './payout-review-form';

function FinancialComposition({
  item,
  showAdvancedFinancialDetails,
  canReviewPayout,
}: {
  item: CaixaItem;
  showAdvancedFinancialDetails: boolean;
  canReviewPayout: boolean;
}) {
  const economics = item.paymentEconomics;
  if (item.tipo !== 'receber' || !item.appointmentId) return null;
  const value = (amount: number | null, unknownLabel: string) =>
    amount === null ? unknownLabel : formatBRL(amount);
  const fee = (amount: number | null, unknownLabel: string) =>
    amount === null ? unknownLabel : `− ${formatBRL(amount)}`;
  const chargeKind = { deposit: 'Sinal', remainder: 'Restante' } as const;
  const chargeStatus = {
    pending: 'Pendente',
    paid: 'Pago',
    expired: 'Expirado',
    cancelled: 'Cancelado',
    refunded: 'Estornado',
    failed: 'Falhou',
  } as const;

  return (
    <details className="border-t border-border bg-surface-2 px-3.5 py-2.5">
      <summary className="cursor-pointer text-(length:--fs-xs) font-semibold text-fg-muted">
        Composição do atendimento
      </summary>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-(length:--fs-xs)">
        <dt className="text-fg-muted">Valor do atendimento</dt>
        <dd className="font-mono tabular-nums">{formatBRL(item.valor)}</dd>
        <dt className="text-fg-muted">Valor recebido alocado</dt>
        <dd className="font-mono tabular-nums">
          {value(economics?.providerGrossAmount ?? null, 'Não informado')}
        </dd>
        <dt className="text-fg-muted">Tarifa real alocada</dt>
        <dd className="font-mono tabular-nums">
          {fee(economics?.providerFeeAmount ?? null, 'Não informado')}
        </dd>
        {showAdvancedFinancialDetails ? (
          <>
            <dt className="text-fg-muted">Custo de antecipação</dt>
            <dd className="font-mono tabular-nums">
              {fee(economics?.earlySettlementFeeAmount ?? null, 'Não informado')}
            </dd>
          </>
        ) : null}
        <dt className="font-medium text-fg">Líquido real alocado</dt>
        <dd className="font-mono font-semibold tabular-nums">
          {value(economics?.providerNetAmount ?? null, 'Não informado')}
        </dd>
        {showAdvancedFinancialDetails && economics?.payout ? (
          <>
            <dt className="mt-1 border-t border-border pt-2 text-fg-muted">Base do repasse</dt>
            <dd className="mt-1 border-t border-border pt-2 text-right font-medium">
              {economics.payout.calculationBasis === 'gross' ? 'Bruto' : 'Líquido'}
            </dd>
            <dt className="text-fg-muted">Valor da base</dt>
            <dd className="font-mono tabular-nums">
              {value(economics.payout.basisAmount, 'Não informado')}
            </dd>
            <dt className="font-medium text-fg">Repasse profissional</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {economics.payout.status === 'cancelled'
                ? 'Suspenso'
                : value(economics.payout.payoutAmount, 'Não informado')}
            </dd>
          </>
        ) : null}
      </dl>
      {showAdvancedFinancialDetails && economics?.payout?.status === 'cancelled' ? (
        <p className="mt-2 text-(length:--fs-xs) font-medium text-fg">
          Repasse suspenso após reversão. Revise o valor devido antes de pagar o profissional.
        </p>
      ) : null}
      {showAdvancedFinancialDetails &&
      economics?.payout &&
      economics.payout.status !== 'cancelled' &&
      economics.payout.basisAmount !== null &&
      economics.payout.payoutAmount !== null &&
      economics.payout.payoutAmount > economics.payout.basisAmount ? (
        // Decisão de 07/10/2026: regra fixa acima do valor é permitida, mas não
        // pode passar despercebida na hora de pagar o profissional.
        <p className="mt-2 text-pretty text-(length:--fs-xs) font-medium text-warning-700">
          Repasse acima do recebido: {formatBRL(economics.payout.payoutAmount)} para uma base de{' '}
          {formatBRL(economics.payout.basisAmount)}. A regra fixa paga o valor inteiro; confira
          antes de pagar o profissional.
        </p>
      ) : null}
      {showAdvancedFinancialDetails &&
      economics?.payout?.status === 'reviewed' &&
      economics.payout.review ? (
        <p className="mt-2 text-pretty text-(length:--fs-xs) font-medium text-fg">
          Repasse revisado na versão {economics.payout.review.version}:{' '}
          {formatBRL(economics.payout.review.decidedAmount)}. Uma nova reversão suspende o repasse
          até outra revisão.
        </p>
      ) : null}
      {showAdvancedFinancialDetails &&
      canReviewPayout &&
      economics?.payout &&
      (economics.payout.status === 'cancelled' || economics.payout.status === 'reviewed') ? (
        economics.payout.reviewBounds ? (
          <PayoutReviewForm
            payoutId={economics.payout.id}
            ceilingAmount={economics.payout.reviewBounds.ceilingAmount}
            referenceAmount={economics.payout.reviewBounds.referenceAmount}
            nextVersion={(economics.payout.review?.version ?? 0) + 1}
          />
        ) : (
          <p className="mt-2 text-pretty text-(length:--fs-xs) text-fg-muted">
            O teto da revisão depende do líquido original informado pelo provedor; a revisão fica
            disponível quando ele chegar.
          </p>
        )
      ) : null}
      {item.chargeEconomics?.length ? (
        <div className="mt-3 border-t border-border pt-2">
          <h4 className="text-(length:--fs-xs) font-semibold text-fg">Cada cobrança Asaas</h4>
          <p className="mt-1 text-(length:--fs-2xs) text-fg-muted">
            Bruto, tarifa e líquido são fatos do pagamento original. Após estorno, confira o saldo
            atual do atendimento.
          </p>
          <div className="mt-2 space-y-2">
            {item.chargeEconomics.map((charge) => (
              <div key={charge.chargeId} className="rounded-md border border-border px-2.5 py-2">
                <div className="flex justify-between gap-3 text-(length:--fs-xs) font-medium">
                  <span>{chargeKind[charge.kind]}</span>
                  <span>{chargeStatus[charge.status]}</span>
                </div>
                <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-(length:--fs-xs)">
                  <dt className="text-fg-muted">Valor solicitado</dt>
                  <dd className="font-mono tabular-nums">{formatBRL(charge.requestedAmount)}</dd>
                  <dt className="text-fg-muted">Bruto no pagamento</dt>
                  <dd className="font-mono tabular-nums">
                    {value(charge.providerGrossAmount, 'Não informado')}
                  </dd>
                  <dt className="text-fg-muted">Tarifa real da cobrança</dt>
                  <dd className="font-mono tabular-nums">
                    {fee(charge.providerFeeAmount, 'Não informado')}
                  </dd>
                  <dt className="text-fg-muted">Líquido no pagamento</dt>
                  <dd className="font-mono tabular-nums">
                    {value(charge.providerNetAmount, 'Não informado')}
                  </dd>
                </dl>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </details>
  );
}

/**
 * Hoje em `YYYY-MM-DD` no fuso das datas do Qoro, para comparar com `dueDate`. Sem fuso
 * explícito o servidor (UTC) e o navegador (Brasília) discordavam depois das 21h e a
 * hidratação acusava #418 (R51).
 */
function todayYmd(): string {
  return todayYmdIn();
}

/** dd/MM — o ano só atrapalha numa fila que é toda do mês corrente. */
function diaCurto(ymd: string): string {
  const [, mes, dia] = ymd.split('-');
  return `${dia}/${mes}`;
}

/** Quantos dias o lançamento está vencido; 0 quando ainda está no prazo. */
function diasVencido(dueDate: string, hoje: string): number {
  return Math.max(
    1,
    Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000),
  );
}

/**
 * "vence hoje" / "vence 12/09" / "venceu 28/08" — o tempo verbal já diz se a
 * data passou, então o operador não precisa comparar com o calendário mental.
 */
function prazo(dueDate: string, hoje: string): string {
  if (dueDate === hoje) return 'vence hoje';
  return dueDate < hoje ? `venceu ${diaCurto(dueDate)}` : `vence ${diaCurto(dueDate)}`;
}

/**
 * Um lançamento como CARTÃO — o formato da referência de setembro/2026.
 *
 * A tabela de sete colunas segue viva no modo abas. Aqui, com as três filas lado
 * a lado, cada coluna teria menos de 100px e o nome do paciente truncaria em
 * duas palavras. O cartão põe identidade e valor na primeira linha e desce o
 * resto — é como a referência resolve a mesma densidade.
 *
 * `variant="compact"` é a linha de duas alturas de "Recebidos hoje" e "A pagar":
 * ali o lançamento já foi resolvido, então total/pago/saldo viram uma frase.
 */
export function CashItemCard({
  item,
  variant,
  canOperate,
  canRefund,
  pending,
  methods,
  paymentTransactions,
  showAdvancedFinancialDetails,
  canReviewPayout = false,
  panelMode,
  onOpenPanel,
  onClosePanel,
  onConfirm,
  onCancel,
  onEstorno,
}: {
  item: CaixaItem;
  variant: 'card' | 'compact';
  canOperate: boolean;
  canRefund: boolean;
  pending: boolean;
  methods: PaymentMethodDTO[];
  paymentTransactions: PaymentTransactionSummary[];
  showAdvancedFinancialDetails: boolean;
  /** MANAGE_FINANCIAL: registra a revisão humana de repasse suspenso. */
  canReviewPayout?: boolean;
  panelMode: CashPanelMode | null;
  onOpenPanel: (mode: CashPanelMode) => void;
  onClosePanel: () => void;
  onConfirm: (item: CaixaItem, valorPago: number, method: string, comprovante: string) => void;
  onCancel: (item: CaixaItem) => void;
  onEstorno: (item: CaixaItem, input: RefundInput) => void;
}) {
  const refundablePayments = paymentTransactions.filter(
    (transaction) => transaction.kind === 'payment' && transaction.refundableAmount > 0,
  );
  const subject = item.tipo === 'pagar' ? item.descricao : (item.pacienteNome ?? 'Walk-in');
  const detail =
    item.tipo === 'pagar' ? 'Conta a pagar' : (item.snapshotProcedureName ?? item.descricao);
  /*
    O catálogo guarda `cartao_credito`; a tela precisa de "Cartão de crédito".
    Mostrar o código cru vazava o identificador do banco para o operador, que
    então lia "dinheiro" e "cartao_credito" na mesma coluna — um com acento e
    outro sem, porque um é rótulo e o outro é chave.
  */
  const formaDePagamento =
    methods.find((m) => m.code === item.paymentMethod)?.label ?? item.paymentMethod;
  const panelId = panelMode ? `cash-panel-${item.id}-${panelMode}` : undefined;
  const emAberto = item.status === 'pendente' || item.status === 'parcial';
  const hoje = todayYmd();
  const vencido = emAberto && item.dueDate != null && item.dueDate < hoje;

  /*
    Rótulo do design: "Confirmar pagamento" diz o que o clique FAZ. "Receber"
    sozinho era ambíguo — parecia registrar o dinheiro na hora, sem o painel de
    conferência que na verdade abre em seguida.
  */
  const actionLabel =
    item.tipo === 'pagar'
      ? 'Pagar'
      : item.status === 'parcial'
        ? 'Receber saldo'
        : 'Confirmar pagamento';

  const badge = (
    <PaymentStatusBadge
      status={item.status}
      overdue={vencido}
      overdueDays={vencido && item.dueDate ? diasVencido(item.dueDate, hoje) : 0}
    />
  );

  /*
    Um botão só na linha fechada. O "Cancelar" ficava colado no "Receber" e
    ambos abriam painel — dois gatilhos de mesmo peso para ações de risco
    oposto. Cancelar passou para dentro do painel de confirmação, onde o valor
    já está à vista.
  */
  const acoes = (
    <>
      {canOperate && emAberto ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-(--hit-target)"
          aria-expanded={panelMode === 'confirm'}
          aria-controls={panelMode === 'confirm' ? panelId : undefined}
          onClick={() => onOpenPanel('confirm')}
          disabled={pending}
        >
          {actionLabel}
        </Button>
      ) : null}
      {canOperate && canMarkPaidInCash(item, methods) ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-(--hit-target)"
          aria-expanded={panelMode === 'cash'}
          aria-controls={panelMode === 'cash' ? panelId : undefined}
          onClick={() => onOpenPanel('cash')}
          disabled={pending}
        >
          {cashActionLabel(item)}
        </Button>
      ) : null}
      {canRefund && refundablePayments.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-(--hit-target)"
          aria-expanded={panelMode === 'estorno'}
          aria-controls={panelMode === 'estorno' ? panelId : undefined}
          onClick={() => onOpenPanel('estorno')}
          disabled={pending}
        >
          Reembolsar
        </Button>
      ) : null}
    </>
  );

  const painel = panelMode ? (
    <div id={panelId} className="border-t border-border bg-surface-2 p-3.5">
      {panelMode === 'confirm' ? (
        <ConfirmPaymentPanel
          item={item}
          methods={methods}
          pending={pending}
          onClose={onClosePanel}
          onRequestCancel={canOperate ? () => onOpenPanel('cancel') : undefined}
          onSubmit={(valorPago, method, comprovante) =>
            onConfirm(item, valorPago, method, comprovante)
          }
        />
      ) : null}
      {panelMode === 'cash' ? (
        <ConfirmPaymentPanel
          item={item}
          methods={methods}
          pending={pending}
          cashOnly
          onClose={onClosePanel}
          onSubmit={(valorPago, method, comprovante) =>
            onConfirm(item, valorPago, method, comprovante)
          }
        />
      ) : null}
      {panelMode === 'cancel' ? (
        <CancelPaymentPanel
          item={item}
          pending={pending}
          onCancel={() => onCancel(item)}
          onClose={onClosePanel}
        />
      ) : null}
      {panelMode === 'estorno' ? (
        <RefundPaymentPanel
          payments={refundablePayments}
          methods={methods}
          pending={pending}
          onClose={onClosePanel}
          onSubmit={(input) => onEstorno(item, input)}
        />
      ) : null}
    </div>
  ) : null;

  if (variant === 'compact') {
    /*
      Aqui a data de vencimento não serve: o item já foi liquidado. O que o
      operador procura é COMO e QUANDO entrou, para bater com a maquininha.
    */
    const quitado = item.status === 'pago' || item.status === 'estornado';
    const meta = [
      formaDePagamento,
      quitado && item.paidAt
        ? new Intl.DateTimeFormat('pt-BR', {
            hourCycle: 'h23',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: QORO_DATE_TIME_ZONE,
          }).format(new Date(item.paidAt))
        : item.dueDate
          ? prazo(item.dueDate, hoje)
          : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="border-b border-border px-3.5 py-2.5 last:border-b-0">
        <div className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate text-(length:--fs-sm) font-medium text-fg-muted">
            {subject}
          </span>
          <span
            className={cn(
              'font-mono text-(length:--fs-sm) font-semibold tabular-nums',
              item.status === 'pago' ? 'text-success-700' : 'text-fg',
            )}
          >
            {formatBRL(item.valor)}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {badge}
          {meta ? (
            <span className="min-w-0 flex-1 truncate text-(length:--fs-2xs) text-fg-subtle">
              {meta}
            </span>
          ) : null}
          {acoes}
        </div>
        <FinancialComposition
          item={item}
          showAdvancedFinancialDetails={showAdvancedFinancialDetails}
          canReviewPayout={canReviewPayout}
        />
        {painel}
      </div>
    );
  }

  return (
    <div
      data-status={item.valorPago === 0 ? item.status : 'com-pagamento'}
      className={cn(
        'overflow-hidden rounded-(--card-radius) border',
        panelMode ? 'border-primary shadow-xs' : vencido ? 'border-danger-200' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-(length:--fs-sm) font-semibold text-fg">{subject}</div>
          <div className="mt-1 truncate text-(length:--fs-xs) text-fg-subtle">
            {[detail, item.snapshotDoctorNome, item.dueDate ? prazo(item.dueDate, hoje) : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <span className="font-mono text-(length:--fs-subsection) font-semibold tabular-nums text-fg">
          {formatBRL(item.valor)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {badge}
          {acoes}
        </div>
      </div>

      {/* Só o parcial abre a grade: num pendente, "já pago R$ 0,00" é ruído. */}
      {item.status === 'parcial' ? (
        <div className="grid grid-cols-3 border-t border-border bg-surface-2 text-(length:--fs-2xs)">
          <div className="border-r border-border px-3.5 py-2">
            <div className="text-fg-muted">Total</div>
            <div className="mt-1 font-mono text-(length:--fs-sm) font-semibold tabular-nums text-fg-muted">
              {formatBRL(item.valor)}
            </div>
          </div>
          <div className="border-r border-border px-3.5 py-2">
            <div className="text-fg-muted">
              Já pago{formaDePagamento ? ` · ${formaDePagamento}` : ''}
            </div>
            <div className="mt-1 font-mono text-(length:--fs-sm) font-semibold tabular-nums text-success-700">
              {formatBRL(item.valorPago)}
            </div>
          </div>
          <div className="px-3.5 py-2">
            <div className="font-semibold text-fg-muted">Saldo</div>
            <div className="mt-1 font-mono text-(length:--fs-sm) font-semibold tabular-nums text-(--primary-active)">
              {formatBRL(outstandingBalance(item))}
            </div>
          </div>
        </div>
      ) : null}

      <FinancialComposition
        item={item}
        showAdvancedFinancialDetails={showAdvancedFinancialDetails}
        canReviewPayout={canReviewPayout}
      />

      {painel}
    </div>
  );
}
