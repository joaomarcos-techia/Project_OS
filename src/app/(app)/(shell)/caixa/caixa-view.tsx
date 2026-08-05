'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type {
  CaixaItem,
  CollectionCaseDTO,
  FaturamentoPendenciaDTO,
  LancamentoStatus,
  PaymentMethodDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { Badge, type badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { formatBRL, formatDatePt } from '@/lib/format';

import { cancelLancamentoAction, confirmPaymentAction, createEstornoAction } from './actions';
import type { ActionResult } from './caixa-types';
import { uuidv4 } from '@/lib/ui/uuid';

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>['tone'];
type PanelMode = 'confirm' | 'cancel' | 'estorno';

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

const saldo = (i: CaixaItem) => Math.round((i.valor - i.valorPago) * 100) / 100;

export function CaixaView({
  pendentes,
  parciais,
  pagosHoje,
  aPagar,
  pendencias,
  collectionCases,
  methods,
  canOperate,
  paymentTransactions,
  canRefund,
}: {
  pendentes: CaixaItem[];
  parciais: CaixaItem[];
  pagosHoje: CaixaItem[];
  aPagar: CaixaItem[];
  pendencias: FaturamentoPendenciaDTO[];
  collectionCases: CollectionCaseDTO[];
  methods: PaymentMethodDTO[];
  paymentTransactions: PaymentTransactionSummary[];
  canOperate: boolean;
  canRefund: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Painel inline por item: 'confirm' (pagamento), 'cancel' (confirmação) ou
  // 'estorno' (motivo). Substitui window.prompt/confirm — não suportados no Next 15.
  const [panel, setPanel] = useState<{ id: string; mode: PanelMode } | null>(null);

  const run = (fn: () => Promise<ActionResult<unknown>>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setPanel(null);
      router.refresh();
    });
  };

  const onConfirm = (item: CaixaItem, valorPago: number, method: string, comprovante: string) =>
    run(() =>
      confirmPaymentAction(
        {
          lancamentoId: item.id,
          paymentMethod: method,
          valorPago,
          comprovante: comprovante.trim()
            ? { type: 'comprovante', fileStoragePath: comprovante.trim() }
            : null,
        },
        uuidv4(),
      ),
    );

  const onCancel = (item: CaixaItem) =>
    run(() => cancelLancamentoAction({ lancamentoId: item.id }, uuidv4()));

  const onEstorno = (
    item: CaixaItem,
    input: Omit<Parameters<typeof createEstornoAction>[0], 'lancamentoId'>,
  ) => run(() => createEstornoAction({ lancamentoId: item.id, ...input }, uuidv4()));

  const openPanel = (id: string, mode: PanelMode) =>
    setPanel((p) => (p?.id === id && p.mode === mode ? null : { id, mode }));
  const closePanel = () => setPanel(null);

  const totalPendente = [...pendentes, ...parciais].reduce((s, i) => s + saldo(i), 0);
  const totalRecebidoHoje = pagosHoje.reduce((s, i) => s + i.valorPago, 0);
  const totalAPagar = aPagar.reduce((s, i) => s + saldo(i), 0);

  const renderItem = (i: CaixaItem, opts: { canOperate: boolean; canRefund: boolean }) => (
    <ItemCard
      key={i.id}
      item={i}
      canOperate={opts.canOperate}
      canRefund={opts.canRefund}
      pending={pending}
      methods={methods}
      paymentTransactions={paymentTransactions.filter((t) => t.lancamentoId === i.id)}
      panelMode={panel?.id === i.id ? panel.mode : null}
      onOpenPanel={(mode) => openPanel(i.id, mode)}
      onClosePanel={closePanel}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onEstorno={onEstorno}
    />
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Caixa' }]}
        title="Caixa"
        description="Recebimentos do dia — confirme pagamentos e acompanhe pendências."
        actions={
          <div className="flex gap-4 text-right">
            <div>
              <div className="font-mono text-[10.5px] tracking-wide text-fg-subtle uppercase">
                A receber
              </div>
              <div className="font-mono font-semibold tabular-nums text-warning-600">
                {formatBRL(totalPendente)}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10.5px] tracking-wide text-fg-subtle uppercase">
                Recebido hoje
              </div>
              <div className="font-mono font-semibold tabular-nums text-success-600">
                {formatBRL(totalRecebidoHoje)}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10.5px] tracking-wide text-fg-subtle uppercase">
                A pagar
              </div>
              <div className="font-mono font-semibold tabular-nums text-danger-600">
                {formatBRL(totalAPagar)}
              </div>
            </div>
          </div>
        }
      />

      {pendencias.length > 0 ? (
        <Alert variant="danger" title="Existem atendimentos não faturados." className="mb-5">
          {pendencias.length} atendimento(s) concluído(s) sem lançamento financeiro. Verifique com o
          gestor — pode haver vazamento de faturamento.
          <ul className="mt-1 list-disc pl-5 text-[12.5px] opacity-90">
            {pendencias.slice(0, 5).map((p) => (
              <li key={p.id}>
                {p.motivo} {p.valor != null ? `(${formatBRL(p.valor)})` : ''}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {collectionCases.length > 0 ? (
        <Alert variant="warning" title="Cobranças aguardando revisão humana" className="mb-5">
          <ul className="list-disc pl-5 text-[12.5px]">
            {collectionCases.slice(0, 10).map((collectionCase) => (
              <li key={collectionCase.id}>
                Lançamento #{collectionCase.lancamentoId.slice(0, 8)} · {collectionCase.daysOverdue}{' '}
                dias em atraso · saldo {formatBRL(collectionCase.residualAmount)}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="danger" className="mb-5">
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-col gap-7">
        <Section title="A receber" count={pendentes.length}>
          {pendentes.length === 0 ? (
            <EmptyState title="Nada pendente" description="Nenhum recebimento em aberto." />
          ) : (
            pendentes.map((i) => renderItem(i, { canOperate, canRefund: false }))
          )}
        </Section>

        {parciais.length > 0 ? (
          <Section title="Pagamento parcial" count={parciais.length}>
            {parciais.map((i) => renderItem(i, { canOperate, canRefund: false }))}
          </Section>
        ) : null}

        <Section title="Recebidos hoje" count={pagosHoje.length}>
          {pagosHoje.length === 0 ? (
            <EmptyState
              title="Nenhum recebimento hoje"
              description="Os pagamentos confirmados hoje aparecem aqui."
            />
          ) : (
            pagosHoje.map((i) => renderItem(i, { canOperate: false, canRefund }))
          )}
        </Section>

        {/* A pagar: acionável (mesmo ItemCard — confirmPayment serve pagável) para
            dar baixa direto no caixa, tanto vencido quanto a vencer (item P2.3). */}
        <Section title="A pagar" count={aPagar.length}>
          {aPagar.length === 0 ? (
            <EmptyState
              title="Nada a pagar"
              description="Contas a pagar em aberto aparecem aqui."
            />
          ) : (
            aPagar.map((i) => renderItem(i, { canOperate, canRefund: false }))
          )}
        </Section>
      </div>
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.09em] text-fg-subtle">
          {title}
        </span>
        <span className="rounded-full bg-surface-inset px-2 py-0.5 text-xs text-fg-muted">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function ItemCard({
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
  panelMode: PanelMode | null;
  onOpenPanel: (mode: PanelMode) => void;
  onClosePanel: () => void;
  onConfirm: (item: CaixaItem, valorPago: number, method: string, comprovante: string) => void;
  onCancel: (item: CaixaItem) => void;
  onEstorno: (
    item: CaixaItem,
    input: {
      paymentId: string;
      valor: number;
      paymentMethod: string;
      motivo: string;
      comprovante: { type: 'comprovante'; fileStoragePath: string } | null;
    },
  ) => void;
}) {
  const refundablePayments = paymentTransactions.filter(
    (transaction) => transaction.kind === 'payment' && transaction.refundableAmount > 0,
  );
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Recebível = paciente-first; pagável = descrição (fornecedor). */}
          <div className="min-w-0">
            <div className="truncate font-medium">
              {item.tipo === 'pagar' ? item.descricao : (item.pacienteNome ?? 'Walk-in')}
            </div>
            <div className="truncate text-sm text-fg-muted">
              {item.tipo === 'pagar'
                ? 'Conta a pagar'
                : (item.snapshotProcedureName ?? item.descricao)}
            </div>
            <div className="mt-0.5 truncate text-xs text-fg-subtle">
              {item.snapshotDoctorNome ? `${item.snapshotDoctorNome} · ` : ''}
              Venc. {formatDatePt(item.dueDate)} · #{item.id.slice(0, 8)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono font-semibold tabular-nums">{formatBRL(item.valor)}</div>
            {item.status === 'parcial' ? (
              <div className="text-xs text-fg-muted tabular-nums">
                Pago {formatBRL(item.valorPago)} · Falta {formatBRL(saldo(item))}
              </div>
            ) : null}
            <Badge tone={STATUS_TONE[item.status]} className="mt-1">
              {STATUS_LABEL[item.status]}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canOperate && (item.status === 'pendente' || item.status === 'parcial') ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onOpenPanel('confirm')}
                disabled={pending}
              >
                Confirmar pagamento
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenPanel('cancel')}
                disabled={pending}
              >
                Cancelar
              </Button>
            </>
          ) : null}
          {canRefund && refundablePayments.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpenPanel('estorno')}
              disabled={pending}
            >
              Reembolsar
            </Button>
          ) : null}
          {item.paymentMethod && item.status === 'pago' ? (
            <Badge tone="gray">{item.paymentMethod}</Badge>
          ) : null}
        </div>

        {panelMode === 'confirm' ? (
          <ConfirmForm
            item={item}
            methods={methods}
            pending={pending}
            onSubmit={(valorPago, method, comprovante) =>
              onConfirm(item, valorPago, method, comprovante)
            }
          />
        ) : null}

        {panelMode === 'cancel' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-inset/40 p-3 text-sm">
            <span>
              Cancelar {item.tipo === 'pagar' ? 'esta conta' : 'este recebimento'}? Esta ação não
              pode ser desfeita.
            </span>
            <Button size="sm" variant="danger" loading={pending} onClick={() => onCancel(item)}>
              Sim, cancelar
            </Button>
            <Button size="sm" variant="ghost" onClick={onClosePanel} disabled={pending}>
              Voltar
            </Button>
          </div>
        ) : null}

        {panelMode === 'estorno' ? (
          <EstornoPanel
            payments={refundablePayments}
            methods={methods}
            pending={pending}
            onClose={onClosePanel}
            onSubmit={(input) => onEstorno(item, input)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConfirmForm({
  item,
  methods,
  pending,
  onSubmit,
}: {
  item: CaixaItem;
  methods: PaymentMethodDTO[];
  pending: boolean;
  onSubmit: (valorPago: number, method: string, comprovante: string) => void;
}) {
  const [valor, setValor] = useState(String(saldo(item).toFixed(2)));
  const [method, setMethod] = useState(methods[0]?.code ?? '');
  const [comprovante, setComprovante] = useState('');

  const valorNum = Number(valor.replace(',', '.'));
  const valid = method && valorNum > 0 && valorNum <= saldo(item) + 1e-9;

  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface-inset/40 p-3 sm:grid-cols-3">
      <Field label="Forma de pagamento" htmlFor={`m-${item.id}`}>
        <Select id={`m-${item.id}`} value={method} onChange={(e) => setMethod(e.target.value)}>
          {methods.map((m) => (
            <option key={m.code} value={m.code}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={item.tipo === 'pagar' ? 'Valor pago' : 'Valor recebido'}
        htmlFor={`v-${item.id}`}
        hint={`Saldo: ${formatBRL(saldo(item))}`}
      >
        <Input
          id={`v-${item.id}`}
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </Field>
      <Field label="Comprovante (caminho/URL — opcional)" htmlFor={`c-${item.id}`}>
        <Input
          id={`c-${item.id}`}
          value={comprovante}
          onChange={(e) => setComprovante(e.target.value)}
        />
      </Field>
      <div className="sm:col-span-3">
        <Button
          size="sm"
          variant="success"
          loading={pending}
          disabled={!valid || pending}
          onClick={() => onSubmit(Math.round(valorNum * 100) / 100, method, comprovante)}
        >
          {item.tipo === 'pagar' ? 'Pagar' : 'Receber'} {formatBRL(valorNum || 0)}
        </Button>
      </div>
    </div>
  );
}

function EstornoPanel({
  payments,
  methods,
  pending,
  onClose,
  onSubmit,
}: {
  payments: PaymentTransactionSummary[];
  methods: PaymentMethodDTO[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    paymentId: string;
    valor: number;
    paymentMethod: string;
    motivo: string;
    comprovante: { type: 'comprovante'; fileStoragePath: string } | null;
  }) => void;
}) {
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? '');
  const selected = payments.find((payment) => payment.id === paymentId);
  const [valor, setValor] = useState(String((selected?.refundableAmount ?? 0).toFixed(2)));
  const [method, setMethod] = useState(methods[0]?.code ?? '');
  const [motivo, setMotivo] = useState('');
  const [comprovante, setComprovante] = useState('');
  const valorNum = Number(valor.replace(',', '.'));
  const valid =
    Boolean(selected) &&
    Boolean(method) &&
    motivo.trim().length > 0 &&
    valorNum > 0 &&
    valorNum <= (selected?.refundableAmount ?? 0) + 1e-9;

  const changePayment = (id: string) => {
    setPaymentId(id);
    const payment = payments.find((candidate) => candidate.id === id);
    setValor(String((payment?.refundableAmount ?? 0).toFixed(2)));
  };

  return (
    <div className="grid gap-3 rounded-md border border-border bg-surface-inset/40 p-3 sm:grid-cols-2">
      <Field label="Pagamento original" htmlFor="refund-payment">
        <Select
          id="refund-payment"
          value={paymentId}
          onChange={(e) => changePayment(e.target.value)}
        >
          {payments.map((payment) => (
            <option key={payment.id} value={payment.id}>
              {formatBRL(payment.refundableAmount)} disponível -{' '}
              {payment.paymentMethod ?? 'método legado'}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Valor a reembolsar"
        htmlFor="refund-value"
        hint={`Disponível: ${formatBRL(selected?.refundableAmount ?? 0)}`}
      >
        <Input
          id="refund-value"
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </Field>
      <Field label="Forma do reembolso" htmlFor="refund-method">
        <Select id="refund-method" value={method} onChange={(e) => setMethod(e.target.value)}>
          {methods.map((paymentMethod) => (
            <option key={paymentMethod.code} value={paymentMethod.code}>
              {paymentMethod.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Comprovante (caminho/URL - opcional)" htmlFor="refund-proof">
        <Input
          id="refund-proof"
          value={comprovante}
          onChange={(e) => setComprovante(e.target.value)}
        />
      </Field>
      <Field label="Motivo do reembolso" htmlFor="estorno-motivo" className="sm:col-span-2">
        <Input
          id="estorno-motivo"
          value={motivo}
          maxLength={200}
          placeholder="Ex.: pagamento em duplicidade"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={!valid || pending}
          onClick={() =>
            onSubmit({
              paymentId,
              valor: Math.round(valorNum * 100) / 100,
              paymentMethod: method,
              motivo: motivo.trim(),
              comprovante: comprovante.trim()
                ? { type: 'comprovante', fileStoragePath: comprovante.trim() }
                : null,
            })
          }
        >
          Confirmar reembolso
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
