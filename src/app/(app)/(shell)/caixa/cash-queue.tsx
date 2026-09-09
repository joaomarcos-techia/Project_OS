'use client';

import { Fragment, useState } from 'react';

import type {
  CaixaItem,
  LancamentoStatus,
  PaymentMethodDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import { Badge, type badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Segmented } from '@/components/ui/segmented';
import {
  Table,
  TableBody,
  TableCell,
  TableCellStack,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { formatBRL, formatDatePt } from '@/lib/format';

import {
  CancelPaymentPanel,
  ConfirmPaymentPanel,
  RefundPaymentPanel,
  type RefundInput,
} from './cash-action-panels';
import { outstandingBalance } from './caixa-money';
import { LocalPager, paginateLocally } from './local-pagination';

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>['tone'];
export type CashPanelMode = 'confirm' | 'cancel' | 'estorno';
type QueueMode = 'receber' | 'parcial' | 'recebido' | 'pagar';

const STATUS_TONE: Record<LancamentoStatus, Tone> = {
  pendente: 'amber',
  parcial: 'blue',
  pago: 'green',
  cancelado: 'gray',
  estornado: 'red',
};

const STATUS_LABEL: Record<LancamentoStatus, string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  cancelado: 'Cancelado',
  estornado: 'Estornado',
};

const QUEUE_LABEL: Record<QueueMode, string> = {
  receber: 'A receber',
  parcial: 'Parcial',
  recebido: 'Recebido hoje',
  pagar: 'A pagar',
};

const EMPTY_COPY: Record<QueueMode, { title: string; description: string }> = {
  receber: { title: 'Nada pendente', description: 'Nenhum recebimento em aberto.' },
  parcial: { title: 'Nenhum pagamento parcial', description: 'Não há saldos parciais em aberto.' },
  recebido: {
    title: 'Nenhum recebimento hoje',
    description: 'Os pagamentos confirmados hoje aparecem aqui.',
  },
  pagar: { title: 'Nada a pagar', description: 'Contas a pagar em aberto aparecem aqui.' },
};

export function CashQueue({
  pendentes,
  parciais,
  pagosHoje,
  aPagar,
  methods,
  paymentTransactionsByLancamento,
  canOperate,
  canRefund,
  pending,
  panel,
  onOpenPanel,
  onClosePanel,
  onConfirm,
  onCancel,
  onEstorno,
}: {
  pendentes: CaixaItem[];
  parciais: CaixaItem[];
  pagosHoje: CaixaItem[];
  aPagar: CaixaItem[];
  methods: PaymentMethodDTO[];
  paymentTransactionsByLancamento: ReadonlyMap<string, PaymentTransactionSummary[]>;
  canOperate: boolean;
  canRefund: boolean;
  pending: boolean;
  panel: { id: string; mode: CashPanelMode } | null;
  onOpenPanel: (id: string, mode: CashPanelMode) => void;
  onClosePanel: () => void;
  onConfirm: (item: CaixaItem, valorPago: number, method: string, comprovante: string) => void;
  onCancel: (item: CaixaItem) => void;
  onEstorno: (item: CaixaItem, input: RefundInput) => void;
}) {
  const [mode, setMode] = useState<QueueMode>('receber');
  const [page, setPage] = useState(1);
  const queues: Record<QueueMode, CaixaItem[]> = {
    receber: pendentes,
    parcial: parciais,
    recebido: pagosHoje,
    pagar: aPagar,
  };
  const items = queues[mode];
  const localPage = paginateLocally(items, page);
  const label = QUEUE_LABEL[mode];

  const selectQueue = (nextMode: QueueMode) => {
    setMode(nextMode);
    setPage(1);
    onClosePanel();
  };

  const selectPage = (nextPage: number) => {
    setPage(nextPage);
    onClosePanel();
  };

  return (
    <section className="qoro-cash-queue" aria-labelledby="cash-queue-title">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div>
          <h2 id="cash-queue-title" className="text-balance text-(length:--fs-sm) font-semibold">
            Fila do caixa
          </h2>
          <p className="text-pretty text-(length:--fs-xs) text-fg-subtle">
            Selecione uma etapa e conclua a ação no próprio lançamento.
          </p>
        </div>
        <span className="text-(length:--fs-xs) text-fg-subtle tabular-nums">
          {items.length} {items.length === 1 ? 'item' : 'itens'}
        </span>
      </div>

      <TableWrap>
        <TableToolbar className="block overflow-x-auto">
          <Segmented
            aria-label="Etapa da fila do caixa"
            className="min-w-max [&>button]:min-h-(--hit-target)"
            value={mode}
            onValueChange={selectQueue}
            options={(
              [
                ['receber', pendentes.length],
                ['parcial', parciais.length],
                ['recebido', pagosHoje.length],
                ['pagar', aPagar.length],
              ] as const
            ).map(([value, count]) => ({
              value,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {QUEUE_LABEL[value]}
                  <span className="text-(length:--fs-2xs) text-fg-subtle tabular-nums">
                    {count}
                  </span>
                </span>
              ),
            }))}
          />
        </TableToolbar>

        {items.length === 0 ? (
          <EmptyState
            variant="compact"
            title={EMPTY_COPY[mode].title}
            description={EMPTY_COPY[mode].description}
          />
        ) : (
          <TableScroll>
            <Table className="min-w-240">
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead numeric>Valor</TableHead>
                  <TableHead numeric>Pago</TableHead>
                  <TableHead numeric>Saldo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localPage.visibleItems.map((item) => (
                  <ItemRows
                    key={item.id}
                    item={item}
                    canOperate={mode !== 'recebido' && canOperate}
                    canRefund={mode === 'recebido' && canRefund}
                    pending={pending}
                    methods={methods}
                    paymentTransactions={paymentTransactionsByLancamento.get(item.id) ?? []}
                    panelMode={panel?.id === item.id ? panel.mode : null}
                    onOpenPanel={(panelMode) => onOpenPanel(item.id, panelMode)}
                    onClosePanel={onClosePanel}
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                    onEstorno={onEstorno}
                  />
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}

        {items.length > 0 ? (
          <TableFoot>
            <TableFootInfo className="tabular-nums">
              {localPage.firstItem}–{localPage.lastItem} de {items.length} em {label.toLowerCase()}
            </TableFootInfo>
            <LocalPager
              label={label}
              page={localPage.page}
              pageCount={localPage.pageCount}
              onPageChange={selectPage}
            />
          </TableFoot>
        ) : null}
      </TableWrap>
    </section>
  );
}

function ItemRows({
  item,
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
  const actionLabel = item.tipo === 'pagar' ? 'Pagar' : 'Receber';
  const panelId = panelMode ? `cash-panel-${item.id}-${panelMode}` : undefined;

  return (
    <Fragment>
      <TableRow
        selected={panelMode !== null}
        data-status={item.valorPago === 0 ? item.status : 'com-pagamento'}
      >
        <TableCell>
          <TableCellStack
            main={subject}
            sub={
              <>
                {detail}
                {item.snapshotDoctorNome ? ` · ${item.snapshotDoctorNome}` : ''}
              </>
            }
          />
        </TableCell>
        <TableCell className="whitespace-nowrap text-fg-muted tabular-nums">
          <time dateTime={item.dueDate ?? undefined}>{formatDatePt(item.dueDate)}</time>
          <span
            className="mt-0.5 block font-mono text-(length:--fs-2xs) text-fg-subtle"
            title={item.id}
          >
            #{item.id.slice(0, 8)}
          </span>
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            {item.paymentMethod && item.status === 'pago' ? (
              <span className="text-(length:--fs-xs) text-fg-subtle">{item.paymentMethod}</span>
            ) : null}
          </div>
        </TableCell>
        <TableCell data-label="Total" numeric>
          {formatBRL(item.valor)}
        </TableCell>
        <TableCell data-label="Pago" numeric>
          {formatBRL(item.valorPago)}
        </TableCell>
        <TableCell
          data-label="Saldo"
          numeric
          className={outstandingBalance(item) > 0 ? 'font-semibold text-fg' : 'text-fg-muted'}
        >
          {formatBRL(outstandingBalance(item))}
        </TableCell>
        <TableCell>
          <div className="flex min-w-52 flex-wrap justify-end gap-1.5">
            {canOperate && (item.status === 'pendente' || item.status === 'parcial') ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="min-h-(--hit-target)"
                  aria-label={`${actionLabel} ${subject}`}
                  aria-expanded={panelMode === 'confirm'}
                  aria-controls={panelMode === 'confirm' ? panelId : undefined}
                  onClick={() => onOpenPanel('confirm')}
                  disabled={pending}
                >
                  {actionLabel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-(--hit-target)"
                  aria-label={`Cancelar ${subject}`}
                  aria-expanded={panelMode === 'cancel'}
                  aria-controls={panelMode === 'cancel' ? panelId : undefined}
                  onClick={() => onOpenPanel('cancel')}
                  disabled={pending}
                >
                  Cancelar
                </Button>
              </>
            ) : null}
            {canRefund && refundablePayments.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="min-h-(--hit-target)"
                aria-label={`Reembolsar ${subject}`}
                aria-expanded={panelMode === 'estorno'}
                aria-controls={panelMode === 'estorno' ? panelId : undefined}
                onClick={() => onOpenPanel('estorno')}
                disabled={pending}
              >
                Reembolsar
              </Button>
            ) : null}
            {!canOperate && !(canRefund && refundablePayments.length > 0) ? (
              <span className="text-(length:--fs-xs) text-fg-subtle">—</span>
            ) : null}
          </div>
        </TableCell>
      </TableRow>

      {panelMode ? (
        <TableRow className="bg-surface-2 hover:bg-surface-2">
          <TableCell id={panelId} colSpan={7} className="p-3">
            {panelMode === 'confirm' ? (
              <ConfirmPaymentPanel
                item={item}
                methods={methods}
                pending={pending}
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
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}
