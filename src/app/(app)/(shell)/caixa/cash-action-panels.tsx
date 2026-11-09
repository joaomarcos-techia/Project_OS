'use client';

import { Ban, Check } from 'lucide-react';
import { useState } from 'react';

import type {
  CaixaItem,
  PaymentMethodDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import { catalogPaymentMethodForCommercial } from '@/contexts/financial/commercial-method';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatBRL } from '@/lib/format';

import { outstandingBalance } from './caixa-money';

export interface RefundInput {
  paymentId: string;
  valor: number;
  paymentMethod: string;
  motivo: string;
  comprovante: { type: 'comprovante'; fileStoragePath: string } | null;
}

/** Código do catálogo para dinheiro — o mesmo que o servidor sempre aceita. */
const CASH_METHOD = catalogPaymentMethodForCommercial('cash');

/** Rótulo da ação de dinheiro: com parte já paga (o sinal, por exemplo), é o restante. */
export function cashActionLabel(item: CaixaItem): string {
  return item.valorPago > 0 ? 'Pagou o restante em dinheiro' : 'Pagou em dinheiro';
}

/** O botão de dinheiro só existe para recebível em aberto e com dinheiro no catálogo. */
export function canMarkPaidInCash(item: CaixaItem, methods: PaymentMethodDTO[]): boolean {
  return (
    item.tipo === 'receber' &&
    (item.status === 'pendente' || item.status === 'parcial') &&
    methods.some((method) => method.code === CASH_METHOD)
  );
}

export function ConfirmPaymentPanel({
  item,
  methods,
  pending,
  cashOnly = false,
  onClose,
  onRequestCancel,
  onSubmit,
}: {
  item: CaixaItem;
  methods: PaymentMethodDTO[];
  pending: boolean;
  /** "Pagou em dinheiro": só dinheiro, saldo inteiro pré-preenchido. */
  cashOnly?: boolean;
  onClose?: () => void;
  /** Ausente quando o perfil nao pode operar o caixa — ai o botao nao existe. */
  onRequestCancel?: (() => void) | undefined;
  onSubmit: (valorPago: number, method: string, comprovante: string) => void;
}) {
  const commercialMethod = catalogPaymentMethodForCommercial(item.commercialPaymentMethod ?? null);
  // Dinheiro na recepção sempre quita o atendimento (08/10/2026): ele aparece ao
  // lado da forma acordada, que segue sendo a única outra opção.
  const availableMethods = cashOnly
    ? methods.filter((paymentMethod) => paymentMethod.code === CASH_METHOD)
    : item.commercialPaymentMethod
      ? methods.filter(
          (paymentMethod) =>
            paymentMethod.code === commercialMethod || paymentMethod.code === CASH_METHOD,
        )
      : methods;
  const [valor, setValor] = useState(String(outstandingBalance(item).toFixed(2)));
  const [method, setMethod] = useState(availableMethods[0]?.code ?? '');
  const [comprovante, setComprovante] = useState('');

  const valorNum = Number(valor.replace(',', '.'));
  const valid =
    availableMethods.some((paymentMethod) => paymentMethod.code === method) &&
    valorNum > 0 &&
    valorNum <= outstandingBalance(item) + 1e-9;
  const actionLabel = item.tipo === 'pagar' ? 'Pagar' : 'Receber';

  return (
    <div className="grid gap-3 rounded-(--r-md) border border-border bg-surface p-3 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <p className="font-medium text-fg">
          {cashOnly ? cashActionLabel(item) : `${actionLabel} lançamento`}
        </p>
        <p className="text-pretty text-(length:--fs-xs) text-fg-muted">
          {cashOnly
            ? 'Registra o dinheiro recebido na recepção. Se o link do restante já foi enviado ao paciente, ele deixa de valer. '
            : 'Confira valor e forma de pagamento antes de confirmar. '}
          Saldo atual:{' '}
          <span className="font-medium tabular-nums">{formatBRL(outstandingBalance(item))}</span>.
        </p>
      </div>
      <Field label="Forma de pagamento" htmlFor={`m-${item.id}`}>
        <Select
          id={`m-${item.id}`}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          {availableMethods.map((paymentMethod) => (
            <option key={paymentMethod.code} value={paymentMethod.code}>
              {paymentMethod.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={item.tipo === 'pagar' ? 'Valor pago' : 'Valor recebido'}
        htmlFor={`v-${item.id}`}
        hint={`Saldo: ${formatBRL(outstandingBalance(item))}`}
      >
        <Input
          id={`v-${item.id}`}
          inputMode="decimal"
          value={valor}
          onChange={(event) => setValor(event.target.value)}
        />
      </Field>
      <Field label="Comprovante (caminho/URL — opcional)" htmlFor={`c-${item.id}`}>
        <Input
          id={`c-${item.id}`}
          value={comprovante}
          onChange={(event) => setComprovante(event.target.value)}
        />
      </Field>
      {/* Confirmar e desistir de um lado; cancelar a cobranca do outro. Sao
          ações de consequencia oposta, e encostadas uma na outra o clique
          errado custa um lancamento. */}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
        <Button
          type="button"
          size="sm"
          className="min-h-(--hit-target)"
          loading={pending}
          disabled={!valid || pending}
          onClick={() => onSubmit(Math.round(valorNum * 100) / 100, method, comprovante)}
        >
          <Check aria-hidden="true" className="size-4" />
          {actionLabel} {formatBRL(valorNum || 0)}
        </Button>
        {onClose ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-(--hit-target)"
            onClick={onClose}
            disabled={pending}
          >
            Voltar
          </Button>
        ) : null}
        {onRequestCancel ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto min-h-(--hit-target) text-danger-700"
            aria-label={`Cancelar ${item.tipo === 'pagar' ? 'conta' : 'cobrança'} de ${item.tipo === 'pagar' ? item.descricao : (item.pacienteNome ?? 'Sem paciente vinculado')}`}
            onClick={onRequestCancel}
            disabled={pending}
          >
            <Ban aria-hidden="true" className="size-4" />
            {item.tipo === 'pagar' ? 'Cancelar conta' : 'Cancelar cobrança'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CancelPaymentPanel({
  item,
  pending,
  onCancel,
  onClose,
}: {
  item: CaixaItem;
  pending: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--r-md) border border-border bg-surface p-3 text-(length:--fs-sm)">
      <div>
        <p className="font-medium text-fg">
          Cancelar {item.tipo === 'pagar' ? 'esta conta' : 'este recebimento'}?
        </p>
        <p className="text-pretty text-fg-muted">
          O saldo de {formatBRL(outstandingBalance(item))} deixará de aparecer em{' '}
          {item.tipo === 'pagar' ? 'A pagar' : 'A receber'}. Esta ação não pode ser desfeita.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="danger"
          className="min-h-(--hit-target)"
          loading={pending}
          onClick={onCancel}
        >
          Sim, cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-(--hit-target)"
          onClick={onClose}
          disabled={pending}
        >
          Voltar
        </Button>
      </div>
    </div>
  );
}

export function RefundPaymentPanel({
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
  onSubmit: (input: RefundInput) => void;
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
    <div className="grid gap-3 rounded-(--r-md) border border-border bg-surface p-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <p className="font-medium text-fg">Confirmar reembolso</p>
        <p className="text-pretty text-(length:--fs-xs) text-fg-muted">
          Selecione a transação de origem, confira o saldo reembolsável e informe o motivo.
        </p>
      </div>
      <Field label="Pagamento original" htmlFor="refund-payment">
        <Select
          id="refund-payment"
          value={paymentId}
          onChange={(event) => changePayment(event.target.value)}
        >
          {payments.map((payment) => (
            <option key={payment.id} value={payment.id}>
              {formatBRL(payment.refundableAmount)} disponível —{' '}
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
          onChange={(event) => setValor(event.target.value)}
        />
      </Field>
      <Field label="Forma do reembolso" htmlFor="refund-method">
        <Select
          id="refund-method"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          {methods.map((paymentMethod) => (
            <option key={paymentMethod.code} value={paymentMethod.code}>
              {paymentMethod.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Comprovante (caminho/URL — opcional)" htmlFor="refund-proof">
        <Input
          id="refund-proof"
          value={comprovante}
          onChange={(event) => setComprovante(event.target.value)}
        />
      </Field>
      <Field label="Motivo do reembolso" htmlFor="estorno-motivo" className="sm:col-span-2">
        <Input
          id="estorno-motivo"
          value={motivo}
          maxLength={200}
          placeholder="Ex.: pagamento em duplicidade"
          onChange={(event) => setMotivo(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-(--hit-target)"
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-(--hit-target)"
          onClick={onClose}
          disabled={pending}
        >
          Voltar
        </Button>
      </div>
    </div>
  );
}
