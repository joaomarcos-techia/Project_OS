'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import type {
  CaixaItem,
  CollectionCaseDTO,
  FaturamentoPendenciaDTO,
  PaymentMethodDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { BreakdownList } from '@/components/ui/breakdown-list';
import { MetricStrip } from '@/components/ui/metric-strip';
import { PanelCard } from '@/components/ui/panel-card';
import { StatCard } from '@/components/ui/stat-card';
import { formatBRL } from '@/lib/format';
import { uuidv4 } from '@/lib/ui/uuid';

import { cancelLancamentoAction, confirmPaymentAction, createEstornoAction } from './actions';
import { outstandingBalance } from './caixa-money';
import { CashQueue, type CashPanelMode } from './cash-queue';
import type { ActionResult } from './caixa-types';
import { LocalPager, paginateLocally } from './local-pagination';

const QUERY_RESULT_LIMIT = 100;

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
  const [panel, setPanel] = useState<{ id: string; mode: CashPanelMode } | null>(null);

  const paymentTransactionsByLancamento = useMemo(() => {
    const indexed = new Map<string, PaymentTransactionSummary[]>();
    for (const transaction of paymentTransactions) {
      const current = indexed.get(transaction.lancamentoId) ?? [];
      current.push(transaction);
      indexed.set(transaction.lancamentoId, current);
    }
    return indexed;
  }, [paymentTransactions]);

  const run = (fn: () => Promise<ActionResult<unknown>>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.message);
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

  const openPanel = (id: string, mode: CashPanelMode) =>
    setPanel((current) => (current?.id === id && current.mode === mode ? null : { id, mode }));
  const closePanel = () => setPanel(null);

  const totalPendente = [...pendentes, ...parciais].reduce(
    (total, item) => total + outstandingBalance(item),
    0,
  );
  const totalRecebidoHoje = pagosHoje.reduce((total, item) => total + item.valorPago, 0);
  const totalAPagar = aPagar.reduce((total, item) => total + outstandingBalance(item), 0);

  /**
   * Agrupa o que JÁ está carregado — `pagosHoje` traz `paymentMethod` por
   * lançamento. Não é query nova nem regra nova: é a mesma soma do "Recebido
   * hoje", quebrada por forma, que é a pergunta seguinte de quem fecha o caixa.
   */
  const recebimentosPorForma = Object.entries(
    pagosHoje.reduce<Record<string, number>>((acc, item) => {
      const forma = item.paymentMethod?.trim() || 'Não informado';
      acc[forma] = (acc[forma] ?? 0) + item.valorPago;
      return acc;
    }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .map(([forma, valor]) => ({
      label: forma,
      value: formatBRL(valor),
      percent: totalRecebidoHoje === 0 ? 0 : (valor / totalRecebidoHoje) * 100,
    }));

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Caixa' }]}
        title="Caixa"
        description="Receba, pague e revise exceções financeiras sem sair da fila operacional."
      />

      {/* As três métricas saíram do slot de ações do header: ação e indicador não
          são a mesma coisa, e amontoá-las lá fazia número parecer botão. */}
      <MetricStrip className="mb-(--sp-4)">
        <StatCard
          label="A receber"
          value={formatBRL(totalPendente)}
          valueTone={totalPendente > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Recebido hoje"
          value={formatBRL(totalRecebidoHoje)}
          valueTone={totalRecebidoHoje > 0 ? 'positive' : 'default'}
        />
        <StatCard
          label="A pagar"
          value={formatBRL(totalAPagar)}
          valueTone={totalAPagar > 0 ? 'warning' : 'default'}
        />
      </MetricStrip>

      {recebimentosPorForma.length > 0 ? (
        <PanelCard
          title="Recebimentos por forma"
          meta={formatBRL(totalRecebidoHoje)}
          className="mb-(--sp-4)"
        >
          <BreakdownList items={recebimentosPorForma} />
        </PanelCard>
      ) : null}

      {pendencias.length > 0 || collectionCases.length > 0 ? (
        <div className="mb-5 grid gap-3 xl:grid-cols-2">
          {pendencias.length > 0 ? (
            <AttentionQueue
              label="atendimentos não faturados"
              title="Atendimentos não faturados"
              variant="danger"
              items={pendencias}
              getKey={(item) => item.id}
              renderItem={(item) => (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="text-pretty">{item.motivo}</span>
                  {item.valor != null ? (
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatBRL(item.valor)}
                    </span>
                  ) : null}
                </div>
              )}
            />
          ) : null}
          {collectionCases.length > 0 ? (
            <AttentionQueue
              label="cobranças em revisão"
              title="Cobranças aguardando revisão humana"
              variant="warning"
              items={collectionCases}
              getKey={(item) => item.id}
              renderItem={(item) => (
                <div className="grid gap-0.5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3">
                  <span>
                    Lançamento{' '}
                    <span className="font-mono" title={item.lancamentoId}>
                      #{item.lancamentoId.slice(0, 8)}
                    </span>{' '}
                    · <span className="tabular-nums">{item.daysOverdue} dias em atraso</span>
                  </span>
                  <span className="font-medium tabular-nums">{formatBRL(item.residualAmount)}</span>
                </div>
              )}
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert variant="danger" className="mb-5">
          {error}
        </Alert>
      ) : null}

      <CashQueue
        pendentes={pendentes}
        parciais={parciais}
        pagosHoje={pagosHoje}
        aPagar={aPagar}
        methods={methods}
        paymentTransactionsByLancamento={paymentTransactionsByLancamento}
        canOperate={canOperate}
        canRefund={canRefund}
        pending={pending}
        panel={panel}
        onOpenPanel={openPanel}
        onClosePanel={closePanel}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onEstorno={onEstorno}
      />
    </>
  );
}

function AttentionQueue<T>({
  label,
  title,
  variant,
  items,
  getKey,
  renderItem,
}: {
  label: string;
  title: string;
  variant: 'danger' | 'warning';
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const localPage = paginateLocally(items, page);

  return (
    <Alert variant={variant} title={`${title} · ${items.length}`}>
      <ul aria-label={label} className="mt-2 divide-y divide-current/10 border-y border-current/10">
        {localPage.visibleItems.map((item) => (
          <li key={getKey(item)} className="py-2 first:pt-1.5 last:pb-1.5">
            {renderItem(item)}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-(length:--fs-xs) tabular-nums">
          {localPage.firstItem}–{localPage.lastItem} de {items.length} carregados
        </span>
        <LocalPager
          label={label}
          page={localPage.page}
          pageCount={localPage.pageCount}
          onPageChange={setPage}
        />
      </div>
      {items.length === QUERY_RESULT_LIMIT ? (
        <p className="mt-1.5 text-pretty text-(length:--fs-xs)">
          A origem desta fila carrega no máximo 100 registros; podem existir itens adicionais.
        </p>
      ) : null}
    </Alert>
  );
}
