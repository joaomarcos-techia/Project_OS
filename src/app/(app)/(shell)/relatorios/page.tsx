/**
 * /relatorios — painéis Solo: faturamento · no-show · ocupação (promessa do
 * plano base). Sem lib de gráfico (decisão): KPIs + barras CSS. Leitura
 * tenant-scoped; faturamento exige view:financial (gate no loader). Ocupação usa
 * o slot-resolver canônico (ver data.ts), nunca contagem ingênua.
 */
import { Ban, CalendarCheck, Check, FileDown, Sheet, UserX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { getCurrentPractitioner } from '@/contexts/identity/internal/practitioner';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatBRL } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import { getRelatorios, PERIODS, resolvePeriod } from './data';
import styles from './reports.module.css';

export const dynamic = 'force-dynamic';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const { periodo } = await searchParams;
  const period = resolvePeriod(periodo);
  const canFinancial = user.permissions.includes(PERMISSIONS.VIEW_FINANCIAL);
  const canManagePayouts = user.permissions.includes(PERMISSIONS.MANAGE_FINANCIAL);
  const canSeeOwnPayouts = !canManagePayouts && (await getCurrentPractitioner());

  const data = await getRelatorios(clinicId, period.days, { includeFaturamento: canFinancial });

  const recebidos = data.semanas.map((semana) => semana.recebido).filter((v) => v != null);
  const semanasComDado = recebidos.length;
  const maiorRecebido = recebidos.length > 0 ? Math.max(...recebidos) : 0;
  const { topo, ticks } = escalaSemanal(maiorRecebido);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Relatórios' }]}
        title="Relatórios"
        description="Indicadores do período"
        meta={<span className="font-mono tabular-nums">{data.timezone}</span>}
        actions={
          <a
            href={`/relatorios/pdf?periodo=${period.key}`}
            target="_blank"
            rel="noopener"
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'min-h-(--hit-target)',
            )}
          >
            <FileDown aria-hidden="true" className="size-4" />
            Exportar PDF
          </a>
        }
      />

      <nav aria-label="Período do relatório" className="qoro-toolbar">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/relatorios?periodo=${p.key}`}
            aria-current={p.key === period.key ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-(--hit-target) shrink-0 items-center rounded-(--r-sm) px-3 text-(length:--fs-sm) font-medium transition-[background-color,color,box-shadow] duration-(--dur-fast)',
              p.key === period.key
                ? 'bg-surface text-fg shadow-(--elev-raised)'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {p.label}
          </Link>
        ))}

        {/* O intervalo saiu da descrição do título: ali ele competia com o nome
            da tela, e aqui fica colado no controle que o define. */}
        <span className="ml-3 border-l border-border pl-3 font-mono text-(length:--fs-sm) font-medium tabular-nums text-fg">
          {data.fromLabel} – {data.toLabel}
        </span>
        <span className="ml-auto text-(length:--fs-sm) text-fg-subtle">
          Dados consolidados no fuso da clínica
        </span>
      </nav>

      {canManagePayouts || canSeeOwnPayouts ? (
        <p className="mb-5">
          <Link href="/relatorios/repasses" className="font-semibold text-(--text-link)">
            Ver repasses por mês
          </Link>
        </p>
      ) : null}

      {/* A referência agrupa por PERGUNTA — dinheiro, faltas, ocupação — em vez de
          alinhar cartões soltos. Cada seção responde uma, e o título diz qual;
          três números nus lado a lado obrigavam a descobrir isso lendo rótulos. */}
      <div className={styles.sections ?? ''}>
        {canFinancial ? (
          <ReportSection
            title="Financeiro do período"
            action={
              <Link href="/financeiro" className="font-semibold text-(--text-link) no-underline">
                Abrir o Financeiro
              </Link>
            }
            cells={[
              { label: 'Recebido', value: brl(data.faturamento.recebido), tone: 'positive' },
              { label: 'Pago', value: brl(data.faturamento.pago) },
              {
                label: 'Saldo',
                value: brl(data.faturamento.saldo),
                tone: data.faturamento.saldo >= 0 ? 'accent' : 'negative',
                note: `${period.days} dias`,
              },
            ]}
          />
        ) : null}

        <ReportSection
          title="Faltas"
          cells={[
            {
              label: 'Taxa de no-show',
              value: pct(data.noShow.taxa),
              tone: (data.noShow.taxa ?? 0) > 0 ? 'warning' : 'default',
              note: 'de consultas com desfecho',
            },
            {
              label: 'Volume',
              value: String(data.noShow.faltou),
              note: `de ${data.noShow.total} consultas`,
            },
          ]}
        />

        <ReportSection
          title="Ocupação"
          cells={[
            {
              label: 'Taxa de ocupação',
              value: pct(data.ocupacao.taxa),
              note:
                data.ocupacao.taxa == null ? 'sem horários configurados' : 'da agenda disponível',
            },
            {
              label: 'Horas',
              value:
                data.ocupacao.taxa == null
                  ? '—'
                  : `${Math.round(data.ocupacao.busyMinutes / 60)} / ${Math.round(
                      (data.ocupacao.busyMinutes + data.ocupacao.freeMinutes) / 60,
                    )}`,
              note: 'ocupadas de disponíveis',
            },
          ]}
        />
      </div>

      {/* Os quatro desfechos numa faixa só, cada um com sua fatia do total: é a
          leitura que a barra empilhada dava de forma aproximada e esta dá exata. */}
      <div className={styles.outcomes ?? ''}>
        <OutcomeCell
          icon={<CalendarCheck aria-hidden="true" />}
          label="Consultas no período"
          value={data.noShow.total}
          note="todas as situações"
        />
        <OutcomeCell
          icon={<Check aria-hidden="true" />}
          label="Atendidas"
          value={data.noShow.atendido}
          note={fatia(data.noShow.atendido, data.noShow.total)}
        />
        <OutcomeCell
          icon={<UserX aria-hidden="true" />}
          label="Faltas"
          value={data.noShow.faltou}
          note={fatia(data.noShow.faltou, data.noShow.total)}
          tone="warning"
        />
        <OutcomeCell
          icon={<Ban aria-hidden="true" />}
          label="Canceladas"
          value={data.noShow.cancelado}
          note={fatia(data.noShow.cancelado, data.noShow.total)}
        />
      </div>

      {/* Série semanal — a referência põe gráfico e tabela na MESMA seção de
          propósito: o gráfico dá a forma da curva, a tabela dá o número exato,
          e separar os dois obrigaria a cruzar duas caixas para ler uma semana. */}
      {canFinancial ? (
        <PanelCard
          title="Faturamento recebido por semana"
          regionLabel="Faturamento recebido por semana"
          meta="R$ · fuso da clínica"
          className="mt-(--sp-4)"
        >
          {semanasComDado === 0 ? (
            <EmptyState
              variant="compact"
              icon={<CalendarCheck />}
              title="Sem recebimentos no período"
              description="As semanas aparecem aqui assim que houver pagamento registrado."
            />
          ) : (
            <>
              {/* O eixo dá ESCALA às barras. Sem ele, a barra mais alta é sempre
                  100 % da área e uma semana de R$ 20 desenha igual a uma de
                  R$ 8.000 — a forma da curva engana em vez de informar. O topo
                  é um número redondo acima do maior valor, e não o próprio
                  maior valor, para que a altura signifique algo estável entre
                  um período e o seguinte. */}
              <div className={styles.weekChart ?? ''} aria-hidden="true">
                <div className={styles.weekGrid ?? ''}>
                  {ticks.map((tick) => (
                    <div
                      key={tick}
                      className={styles.weekGridLine ?? ''}
                      style={{ bottom: `${topo === 0 ? 0 : (tick / topo) * 100}%` }}
                    >
                      <span>{tick === 0 ? 'R$ 0' : tick.toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.weekBars ?? ''}>
                  {data.semanas.map((semana) => (
                    <div key={semana.weekStart} className={styles.weekBar ?? ''}>
                      <span
                        className={cn(
                          styles.weekValue,
                          (semana.recebido == null || semana.futura) && styles.weekValueEmpty,
                        )}
                      >
                        {semana.futura
                          ? 'período futuro'
                          : semana.recebido == null
                            ? 'sem dado'
                            : formatBRL(semana.recebido)}
                      </span>
                      {semana.emCurso && semana.recebido != null ? (
                        <span className={styles.weekOngoing ?? ''}>em curso</span>
                      ) : null}
                      {semana.futura ? (
                        /* Altura zero e hachura: não é uma barra baixa, é a
                           ausência de barra. Desenhá-la como "sem dado" diria
                           que faltou registro numa semana que nem começou. */
                        <span className={cn(styles.weekFill, styles.weekFillFuture)} />
                      ) : semana.recebido == null ? (
                        <span className={cn(styles.weekFill, styles.weekFillEmpty)} />
                      ) : (
                        /* Hachura na semana em curso: a barra mostra o que já
                           entrou, e a textura diz que o número ainda vai subir.
                           Pintar sólido a colocaria em pé de igualdade com as
                           semanas fechadas e faria uma queda aparecer do nada
                           toda segunda-feira. */
                        <span
                          className={cn(styles.weekFill, semana.emCurso && styles.weekFillPartial)}
                          style={{
                            height: `${topo === 0 ? 0 : (semana.recebido / topo) * 100}%`,
                          }}
                        />
                      )}
                      <span className={styles.weekLabel ?? ''}>{semana.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Table className={styles.weekTable ?? ''}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Semana</TableHead>
                    <TableHead>Recebido</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Atendidas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* A semana futura fica só no gráfico, onde serve de contexto.
                      Na TABELA ela seria uma linha inteira de "sem dado" sobre
                      dias que ainda não chegaram — ruído com cara de lacuna. */}
                  {data.semanas
                    .filter((semana) => !semana.futura)
                    .map((semana) => (
                      <TableRow key={semana.weekStart}>
                        <TableCell className="font-medium">{semana.label}</TableCell>
                        <TableCell>{moedaOuVazio(semana.recebido)}</TableCell>
                        <TableCell>{moedaOuVazio(semana.pago)}</TableCell>
                        <TableCell className="font-semibold text-fg">
                          {moedaOuVazio(semana.saldo)}
                        </TableCell>
                        <TableCell>
                          {semana.atendido == null ? SEM_DADO : semana.atendido}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </>
          )}
        </PanelCard>
      ) : null}

      {canFinancial ? (
        <PanelCard
          title="Arquivo para contabilidade"
          meta="CSV mensal · não fiscal"
          regionLabel="Exportação financeira para contabilidade"
          className="mt-(--sp-4)"
        >
          <form
            action="/relatorios/contabilidade.csv"
            method="get"
            className="flex flex-wrap items-end gap-(--sp-3)"
          >
            <label className="grid gap-1 text-(length:--fs-sm) font-medium text-fg">
              Mês de referência
              <input
                type="month"
                name="mes"
                required
                defaultValue={data.accountingMonth}
                min="2000-01"
                max="2100-12"
                className="min-h-(--hit-target) rounded-(--r-sm) border border-border bg-surface px-3 text-fg tabular-nums"
              />
            </label>
            <button
              type="submit"
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'sm' }),
                'min-h-(--hit-target)',
              )}
            >
              <Sheet aria-hidden="true" className="size-4" />
              Exportar CSV
            </button>
          </form>
          <p className="mt-(--sp-3) max-w-3xl text-(length:--fs-sm) text-fg-muted">
            Movimentos de caixa, pagamentos e estornos do mês para conferência contábil. Este
            arquivo é operacional e não substitui nota fiscal, Receita Saúde ou documento do Asaas.
          </p>
        </PanelCard>
      ) : null}
    </>
  );
}

/**
 * Topo redondo e três degraus, como a referência (0 / 2.000 / 4.000 / 6.000).
 *
 * O passo sai de uma escada de multiplicadores "legíveis" (1, 2, 2,5, 5…) sobre
 * a ordem de grandeza do valor: é o que faz o rótulo do eixo ser um número que
 * alguém diria em voz alta, e não `R$ 2.613,33`.
 */
function escalaSemanal(maior: number): { topo: number; ticks: number[] } {
  if (maior <= 0) return { topo: 0, ticks: [0] };
  const alvo = maior / 3;
  const magnitude = 10 ** Math.floor(Math.log10(alvo));
  const passo =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((c) => c >= alvo) ??
    10 * magnitude;
  return { topo: passo * 3, ticks: [0, passo, passo * 2, passo * 3] };
}

/** Fatia de um desfecho sobre o total, no formato da referência ("88,9 % do total"). */
function fatia(parte: number, total: number): string {
  if (total === 0) return 'sem consultas no período';
  return `${((parte / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} % do total`;
}

type CellTone = 'default' | 'positive' | 'negative' | 'warning' | 'accent';

const CELL_TONE: Record<CellTone, string> = {
  default: 'text-fg',
  positive: 'text-success-700',
  negative: 'text-danger-700',
  warning: 'text-warning-700',
  accent: 'text-(--primary-active)',
};

/**
 * Uma seção de indicadores — título em cima, células divididas por filete.
 *
 * A referência usa a mesma peça três vezes (dinheiro, faltas, ocupação) mudando
 * só quantas células entram; por isso ela é um componente e não três blocos.
 */
function ReportSection({
  title,
  action,
  cells,
}: {
  title: string;
  action?: ReactNode;
  cells: { label: string; value: string; note?: string; tone?: CellTone }[];
}) {
  return (
    <section aria-label={title} className={styles.section ?? ''}>
      <div className={styles.sectionHead ?? ''}>
        <h2>{title}</h2>
        {action ? <span className={styles.sectionAction ?? ''}>{action}</span> : null}
      </div>
      <div className={styles.sectionCells ?? ''}>
        {cells.map((cell) => (
          <div key={cell.label}>
            <span className={styles.cellLabel ?? ''}>{cell.label}</span>
            <span className={cn(styles.cellValue, CELL_TONE[cell.tone ?? 'default'])}>
              {cell.value}
            </span>
            {cell.note ? <span className={styles.cellNote ?? ''}>{cell.note}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Célula da faixa de desfechos: ícone + rótulo, valor e a fatia do total. */
function OutcomeCell({
  icon,
  label,
  value,
  note,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: number;
  note: string;
  tone?: CellTone;
}) {
  return (
    <div>
      <span className={styles.cellLabel ?? ''}>
        {icon}
        {label}
      </span>
      <span className={cn(styles.cellValue, CELL_TONE[tone])}>{value}</span>
      <span className={styles.cellNote ?? ''}>{note}</span>
    </div>
  );
}

const SEM_DADO = <span className="text-fg-subtle">sem dado</span>;

/** Semana sem lançamento não vira "R$ 0,00" — vira "sem dado". */
function moedaOuVazio(valor: number | null) {
  return valor == null ? SEM_DADO : formatBRL(valor);
}
