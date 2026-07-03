'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type {
  CaixaItem,
  FaturamentoPendenciaDTO,
  LancamentoStatus,
  PaymentMethodDTO,
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
  pendencias,
  methods,
  canOperate,
  canManage,
}: {
  pendentes: CaixaItem[];
  parciais: CaixaItem[];
  pagosHoje: CaixaItem[];
  pendencias: FaturamentoPendenciaDTO[];
  methods: PaymentMethodDTO[];
  canOperate: boolean;
  canManage: boolean;
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
        crypto.randomUUID(),
      ),
    );

  const onCancel = (item: CaixaItem) =>
    run(() => cancelLancamentoAction({ lancamentoId: item.id }, crypto.randomUUID()));

  const onEstorno = (item: CaixaItem, motivo: string) =>
    run(() => createEstornoAction({ lancamentoId: item.id, motivo }, crypto.randomUUID()));

  const openPanel = (id: string, mode: PanelMode) =>
    setPanel((p) => (p?.id === id && p.mode === mode ? null : { id, mode }));
  const closePanel = () => setPanel(null);

  const totalPendente = [...pendentes, ...parciais].reduce((s, i) => s + saldo(i), 0);
  const totalRecebidoHoje = pagosHoje.reduce((s, i) => s + i.valorPago, 0);

  const renderItem = (i: CaixaItem, opts: { canOperate: boolean; canManage: boolean }) => (
    <ItemCard
      key={i.id}
      item={i}
      canOperate={opts.canOperate}
      canManage={opts.canManage}
      pending={pending}
      methods={methods}
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
              <div className="font-mono text-[10.5px] tracking-wide text-fg-subtle uppercase">A receber</div>
              <div className="font-mono font-semibold tabular-nums text-warning-600">
                {formatBRL(totalPendente)}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10.5px] tracking-wide text-fg-subtle uppercase">Recebido hoje</div>
              <div className="font-mono font-semibold tabular-nums text-success-600">
                {formatBRL(totalRecebidoHoje)}
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
            pendentes.map((i) => renderItem(i, { canOperate, canManage: false }))
          )}
        </Section>

        {parciais.length > 0 ? (
          <Section title="Pagamento parcial" count={parciais.length}>
            {parciais.map((i) => renderItem(i, { canOperate, canManage: false }))}
          </Section>
        ) : null}

        <Section title="Recebidos hoje" count={pagosHoje.length}>
          {pagosHoje.length === 0 ? (
            <EmptyState title="Nenhum recebimento hoje" description="Os pagamentos confirmados hoje aparecem aqui." />
          ) : (
            pagosHoje.map((i) => renderItem(i, { canOperate: false, canManage }))
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
        <span className="rounded-full bg-surface-inset px-2 py-0.5 text-xs text-fg-muted">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function ItemCard({
  item,
  canOperate,
  canManage,
  pending,
  methods,
  panelMode,
  onOpenPanel,
  onClosePanel,
  onConfirm,
  onCancel,
  onEstorno,
}: {
  item: CaixaItem;
  canOperate: boolean;
  canManage: boolean;
  pending: boolean;
  methods: PaymentMethodDTO[];
  panelMode: PanelMode | null;
  onOpenPanel: (mode: PanelMode) => void;
  onClosePanel: () => void;
  onConfirm: (item: CaixaItem, valorPago: number, method: string, comprovante: string) => void;
  onCancel: (item: CaixaItem) => void;
  onEstorno: (item: CaixaItem, motivo: string) => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          {/* patient-first */}
          <div className="min-w-0">
            <div className="truncate font-medium">{item.pacienteNome ?? 'Walk-in'}</div>
            <div className="truncate text-sm text-fg-muted">
              {item.snapshotProcedureName ?? item.descricao}
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
              <Button size="sm" variant="primary" onClick={() => onOpenPanel('confirm')} disabled={pending}>
                Confirmar pagamento
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onOpenPanel('cancel')} disabled={pending}>
                Cancelar
              </Button>
            </>
          ) : null}
          {canManage && item.status === 'pago' ? (
            <Button size="sm" variant="secondary" onClick={() => onOpenPanel('estorno')} disabled={pending}>
              Estornar
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
            onSubmit={(valorPago, method, comprovante) => onConfirm(item, valorPago, method, comprovante)}
          />
        ) : null}

        {panelMode === 'cancel' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-inset/40 p-3 text-sm">
            <span>Cancelar este recebimento? Esta ação não pode ser desfeita.</span>
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
            pending={pending}
            onClose={onClosePanel}
            onSubmit={(motivo) => onEstorno(item, motivo)}
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
      <Field label="Valor recebido" htmlFor={`v-${item.id}`} hint={`Saldo: ${formatBRL(saldo(item))}`}>
        <Input
          id={`v-${item.id}`}
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </Field>
      <Field label="Comprovante (caminho/URL — opcional)" htmlFor={`c-${item.id}`}>
        <Input id={`c-${item.id}`} value={comprovante} onChange={(e) => setComprovante(e.target.value)} />
      </Field>
      <div className="sm:col-span-3">
        <Button
          size="sm"
          variant="success"
          loading={pending}
          disabled={!valid || pending}
          onClick={() => onSubmit(Math.round(valorNum * 100) / 100, method, comprovante)}
        >
          Receber {formatBRL(valorNum || 0)}
        </Button>
      </div>
    </div>
  );
}

function EstornoPanel({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const valid = motivo.trim().length > 0;
  return (
    <div className="rounded-md border border-border bg-surface-inset/40 p-3">
      <Field label="Motivo do estorno (registro contábil)" htmlFor="estorno-motivo">
        <Input
          id="estorno-motivo"
          value={motivo}
          maxLength={200}
          placeholder="Ex.: pagamento em duplicidade"
          onChange={(e) => setMotivo(e.target.value)}
        />
      </Field>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={!valid || pending}
          onClick={() => onSubmit(motivo.trim())}
        >
          Confirmar estorno
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
