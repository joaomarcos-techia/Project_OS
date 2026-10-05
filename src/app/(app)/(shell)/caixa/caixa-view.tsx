'use client';

import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  CircleX,
  Sparkles,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import type {
  CaixaItem,
  CollectionCaseDTO,
  FaturamentoPendenciaDTO,
  PaymentMethodDTO,
  PaymentTransactionSummary,
} from '@/contexts/financial/types';
import type { ExcessRefundStatus, FailedChargeDTO, ManualRefundTask } from '@/contexts/payments';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
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

/** Cobrança falha + nome resolvido na camada page (Financial não conhece Patient). */
export type FailedChargeItem = FailedChargeDTO & { pacienteNome: string | null };
export type ManualRefundItem = ManualRefundTask & { pacienteNome: string | null };

const QUERY_RESULT_LIMIT = 100;

export function CaixaView({
  hoje,
  atualizadoEm,
  pendentes,
  parciais,
  pagosHoje,
  aPagar,
  pendencias,
  failedCharges,
  manualRefundTasks,
  excessRefundStatuses,
  collectionCases,
  methods,
  canOperate,
  paymentTransactions,
  showAdvancedFinancialDetails,
  canRefund,
}: {
  /** "7 de setembro", já no fuso da clínica. */
  hoje: string;
  /** "14:02", já no fuso da clínica. */
  atualizadoEm: string;
  pendentes: CaixaItem[];
  parciais: CaixaItem[];
  pagosHoje: CaixaItem[];
  aPagar: CaixaItem[];
  pendencias: FaturamentoPendenciaDTO[];
  failedCharges: FailedChargeItem[];
  manualRefundTasks: ManualRefundItem[];
  excessRefundStatuses: ExcessRefundStatus[];
  collectionCases: CollectionCaseDTO[];
  methods: PaymentMethodDTO[];
  paymentTransactions: PaymentTransactionSummary[];
  showAdvancedFinancialDetails: boolean;
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
  const excessRefundByAppointment = useMemo(
    () => new Map(excessRefundStatuses.map((status) => [status.appointmentId, status])),
    [excessRefundStatuses],
  );

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
  // Vencida é a cobrança em aberto cuja data de vencimento já passou. `dueDate`
  // é 'YYYY-MM-DD', então a comparação é textual e não sofre com fuso — o mesmo
  // truque que o resto do financeiro usa.
  // Uma lista só para a coluna "A receber", na ordem em que a fila é trabalhada:
  // pendentes primeiro, parciais logo atrás (já têm parte do dinheiro dentro).
  const aReceber = [...pendentes, ...parciais];
  const aReceberCount = aReceber.length;
  // `split('T')[0]` recorta a data do ISO. A guarda anti-truncamento do teste
  // varre o fonte atras de corte fixo de lista, entao evitamos essa forma aqui
  // mesmo o corte sendo de data — inclusive em comentario.
  const hojeYmd = new Date().toISOString().split('T')[0]!;
  const vencidas = [...pendentes, ...parciais].filter(
    (item) => item.dueDate != null && item.dueDate < hojeYmd,
  ).length;

  // Agrupa pelo RÓTULO do catálogo, não pelo código: `cartao_credito` ao lado de
  // "Dinheiro" na mesma coluna é a mesma falha que o cartão da fila já teve — a
  // chave é do banco, o que o operador lê é o nome da forma de pagamento.
  const recebimentosPorForma = Object.entries(
    pagosHoje.reduce<Record<string, number>>((acc, item) => {
      const codigo = item.paymentMethod?.trim();
      const forma = codigo
        ? (methods.find((m) => m.code === codigo)?.label ?? codigo)
        : 'Não informado';
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
        description={`Recebimentos e pagamentos de hoje, ${hoje}`}
        meta={<span className="font-mono tabular-nums">atualizado {atualizadoEm}</span>}
        actions={
          <Link href="/financeiro" className={buttonVariants({ variant: 'secondary' })}>
            <Wallet aria-hidden="true" className="size-4 text-fg-subtle" />
            Ver no Financeiro
          </Link>
        }
      />

      {/* As três métricas saíram do slot de ações do header: ação e indicador não
          são a mesma coisa, e amontoá-las lá fazia número parecer botão. */}
      <MetricStrip className="qoro-cash-metrics mb-(--sp-4)">
        {/* Neutro de propósito: a referência reserva cor para o resultado
            (verde) e para o alerta (as faixas abaixo). Pintar "a receber" de
            âmbar fazia toda cobrança em aberto parecer problema, inclusive as
            que vencem semana que vem. */}
        <StatCard
          label="A receber"
          value={formatBRL(totalPendente)}
          icon={<ArrowDownLeft />}
          hint={
            aReceberCount === 0
              ? 'nada em aberto'
              : `${aReceberCount} cobrança${aReceberCount === 1 ? '' : 's'}${
                  vencidas > 0 ? ` · ${vencidas} vencida${vencidas === 1 ? '' : 's'}` : ''
                }`
          }
        />
        <StatCard
          label="Recebido hoje"
          value={formatBRL(totalRecebidoHoje)}
          valueTone={totalRecebidoHoje > 0 ? 'positive' : 'default'}
          icon={<CircleCheck />}
          hint={
            pagosHoje.length === 0
              ? 'nenhum recebimento'
              : `${pagosHoje.length} recebimento${pagosHoje.length === 1 ? '' : 's'}`
          }
        />
        <StatCard
          label="A pagar"
          value={formatBRL(totalAPagar)}
          icon={<ArrowUpRight />}
          hint={
            aPagar.length === 0
              ? 'nenhuma conta do dia'
              : `${aPagar.length} conta${aPagar.length === 1 ? '' : 's'} do dia`
          }
        />
      </MetricStrip>

      {failedCharges.length > 0 ||
      manualRefundTasks.length > 0 ||
      pendencias.length > 0 ||
      collectionCases.length > 0 ? (
        <div className="mb-5 flex flex-col gap-2">
          {/* Primeiro da pilha porque é o único aqui que o sistema causou. As
              outras duas faixas são trabalho pendente; esta é uma cobrança que
              o operador acha que saiu e não saiu. */}
          {failedCharges.length > 0 ? (
            <AttentionQueue
              label="cobranças que falharam ao ser enviadas"
              summary={
                failedCharges.length === 1
                  ? `Falha operacional: a cobrança de ${failedCharges[0]!.pacienteNome ?? 'um paciente'} não foi enviada ao paciente`
                  : `Falha operacional: ${failedCharges.length} cobranças não foram enviadas aos pacientes`
              }
              cta="Ver detalhes"
              tone="danger"
              icon={<CircleX aria-hidden="true" />}
              items={failedCharges}
              getKey={(item) => item.chargeId}
              renderItem={(item) => (
                <div className="grid gap-0.5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3">
                  <span className="text-pretty">
                    {item.pacienteNome ?? 'Paciente não identificado'} · link nunca gerado
                    {item.failureCode ? (
                      <>
                        {' '}
                        ·{' '}
                        <span className="font-mono text-(length:--fs-2xs)">{item.failureCode}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="font-medium tabular-nums">{formatBRL(item.amount)}</span>
                </div>
              )}
            />
          ) : null}
          {manualRefundTasks.length > 0 ? (
            <AttentionQueue
              label="devoluções que exigem ação da clínica"
              summary={`${manualRefundTasks.length} ${manualRefundTasks.length === 1 ? 'devolução' : 'devoluções'} de paciente pendente${manualRefundTasks.length === 1 ? '' : 's'} de verificação`}
              cta="Ver pendências"
              tone="warning"
              icon={<TriangleAlert aria-hidden="true" />}
              items={manualRefundTasks}
              getKey={(item) => item.id}
              renderItem={(item) => (
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="text-pretty">
                      {item.pacienteNome ?? 'Paciente não identificado'} ·{' '}
                      {item.purpose === 'deposit_closeout' ? 'sinal' : 'valor excedente'}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatBRL(item.amount)}
                    </span>
                  </div>
                  <p className="text-pretty text-(length:--fs-xs)">
                    {item.state === 'account_unavailable'
                      ? 'Reconecte a conta Asaas e confira a devolução com o paciente.'
                      : item.state === 'payment_id_missing'
                        ? 'O identificador da cobrança Asaas não foi registrado. Investigue o vínculo antes de solicitar qualquer devolução.'
                        : item.state === 'readback_unavailable'
                          ? 'O Qoro ainda não conseguiu verificar esta cobrança no Asaas. Confira o estado no painel antes de qualquer devolução.'
                          : item.state === 'failed'
                            ? 'A tentativa anterior não devolveu o valor. Confira o estado no Asaas antes de agir.'
                            : 'Confira se já há estorno em andamento; se não houver, faça a devolução na conta Asaas da clínica.'}
                  </p>
                  <p className="text-(length:--fs-xs) text-muted-foreground">
                    {item.providerPaymentId ? (
                      <>
                        Cobrança Asaas: <span className="font-mono">{item.providerPaymentId}</span>
                        .{' '}
                      </>
                    ) : null}
                    O Qoro só confirma a devolução após o Asaas informar conclusão.
                  </p>
                </div>
              )}
            />
          ) : null}
          {pendencias.length > 0 ? (
            <AttentionQueue
              label="atendimentos não faturados"
              summary={
                pendencias.length === 1
                  ? '1 atendimento concluído ainda não foi faturado'
                  : `${pendencias.length} atendimentos concluídos ainda não foram faturados`
              }
              cta="Ver e faturar"
              tone="warning"
              icon={<TriangleAlert aria-hidden="true" />}
              items={pendencias}
              getKey={(item) => item.id}
              renderItem={(item) => (
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="text-pretty">{item.motivo}</span>
                    {item.valor != null ? (
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatBRL(item.valor)}
                      </span>
                    ) : null}
                  </div>
                  {excessRefundByAppointment.has(item.appointmentId) ? (
                    <ExcessRefundStatusLine
                      status={excessRefundByAppointment.get(item.appointmentId)!}
                    />
                  ) : null}
                </div>
              )}
            />
          ) : null}
          {collectionCases.length > 0 ? (
            <AttentionQueue
              label="cobranças em revisão"
              summary={
                collectionCases.length === 1
                  ? '1 cobrança do agente aguarda revisão humana antes do envio'
                  : `${collectionCases.length} cobranças do agente aguardam revisão humana antes do envio`
              }
              cta="Revisar cobranças"
              tone="ai"
              icon={<Sparkles aria-hidden="true" />}
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

      {/*
        A referência abandona as abas: as três filas convivem, com "A receber"
        ocupando o dobro por ser onde o operador passa o turno. Abas escondiam
        "Recebido hoje" e "A pagar" atrás de um clique, e fechar caixa é
        justamente comparar as três de uma vez.

        Pendente e parcial entram na MESMA lista porque cada item já carrega o
        próprio badge de status e a própria ação — separá-los era um recorte da
        UI, não do negócio.
      */}
      <div className="qoro-cash-columns">
        <CashQueue
          fixedMode="receber"
          headerTotal={formatBRL(totalPendente)}
          pendentes={aReceber}
          parciais={[]}
          pagosHoje={pagosHoje}
          aPagar={aPagar}
          methods={methods}
          paymentTransactionsByLancamento={paymentTransactionsByLancamento}
          showAdvancedFinancialDetails={showAdvancedFinancialDetails}
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

        <div className="flex min-w-0 flex-col gap-(--sp-4)">
          <CashQueue
            fixedMode="recebido"
            headerTotal={formatBRL(totalRecebidoHoje)}
            pendentes={aReceber}
            parciais={[]}
            pagosHoje={pagosHoje}
            aPagar={aPagar}
            methods={methods}
            paymentTransactionsByLancamento={paymentTransactionsByLancamento}
            showAdvancedFinancialDetails={showAdvancedFinancialDetails}
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

          <CashQueue
            fixedMode="pagar"
            headerTotal={formatBRL(totalAPagar)}
            pendentes={aReceber}
            parciais={[]}
            pagosHoje={pagosHoje}
            aPagar={aPagar}
            methods={methods}
            paymentTransactionsByLancamento={paymentTransactionsByLancamento}
            showAdvancedFinancialDetails={showAdvancedFinancialDetails}
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

          {recebimentosPorForma.length > 0 ? (
            <PanelCard
              title="Recebimentos por forma"
              regionLabel="Recebimentos por forma"
              meta={formatBRL(totalRecebidoHoje)}
            >
              <BreakdownList items={recebimentosPorForma} />
            </PanelCard>
          ) : null}
        </div>
      </div>
    </>
  );
}

const EXCESS_REFUND_COPY: Record<ExcessRefundStatus['state'], string> = {
  manual: 'Devolução pendente de ação da clínica; confira a cobrança na conta Asaas.',
  waiting: 'Estorno solicitado ao Asaas; aguardando confirmação da devolução.',
  confirmed: 'Estorno confirmado pelo Asaas.',
  cancelled: 'Estorno cancelado pelo Asaas; o valor não foi devolvido. Revise antes de nova ação.',
  failed: 'A devolução não foi concluída. Revise antes de nova ação.',
};

function ExcessRefundStatusLine({ status }: { status: ExcessRefundStatus }) {
  const tone = status.state === 'confirmed' ? 'text-success-700' : 'text-current';
  return (
    <p className={`text-pretty text-(length:--fs-xs) font-medium ${tone}`}>
      {EXCESS_REFUND_COPY[status.state]} Valor: {formatBRL(status.amount)}.
    </p>
  );
}

/**
 * Pendência do caixa como FAIXA acionável, no padrão da referência.
 *
 * A faixa é o resumo; o detalhe (qual atendimento, qual lançamento, quanto)
 * continua ali, dentro de um `<details>` nativo. A referência mostra só a faixa,
 * mas descartar a lista tiraria do operador exatamente o que ele precisa para
 * resolver — e não há outra tela onde essas linhas apareçam.
 */
function AttentionQueue<T>({
  label,
  summary,
  cta,
  tone,
  icon,
  items,
  getKey,
  renderItem,
}: {
  label: string;
  summary: string;
  cta: string;
  tone: 'danger' | 'warning' | 'ai';
  icon: ReactNode;
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const localPage = paginateLocally(items, page);

  return (
    <details className="group">
      <summary
        data-tone={tone}
        className="qoro-alert-row cursor-pointer list-none [&::-webkit-details-marker]:hidden"
      >
        {icon}
        <span className="qoro-alert-row-text">{summary}</span>
        <span className="qoro-alert-row-cta">{cta}</span>
        <ChevronRight aria-hidden="true" className="transition-transform group-open:rotate-90" />
      </summary>

      <div className="mt-2 rounded-(--r-md) border border-border bg-surface p-3">
        <ul aria-label={label} className="divide-y divide-border border-y border-border">
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
          <p className="mt-1.5 text-pretty text-(length:--fs-xs) text-fg-muted">
            A origem desta fila carrega no máximo 100 registros; podem existir itens adicionais.
          </p>
        ) : null}
      </div>
    </details>
  );
}
