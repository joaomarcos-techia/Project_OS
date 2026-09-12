'use client';

import type {
  CaixaItem,
  PaymentMethodDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import { Button } from '@/components/ui/button';
import { PaymentStatusBadge } from '@/components/ui/status-badge';
import { formatBRL } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import {
  CancelPaymentPanel,
  ConfirmPaymentPanel,
  RefundPaymentPanel,
  type RefundInput,
} from './cash-action-panels';
import { outstandingBalance } from './caixa-money';
import type { CashPanelMode } from './caixa-types';

/** Data local de hoje em `YYYY-MM-DD`, para comparar com `dueDate`. */
function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
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

      {painel}
    </div>
  );
}
