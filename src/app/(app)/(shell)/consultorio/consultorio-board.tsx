'use client';

import { Calendar, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/ui/cn';
import {
  useConsultorioPolling,
  type ConsultorioRefreshState,
} from '@/lib/realtime/use-consultorio-polling';

import { callNextPatient, checkInPatient, completeConsulta, getBoard, markAbsent } from './actions';
import { AttendingPanel } from './attending-panel';
import type { ActionResult, BoardDTO } from './board-types';
import { CheckinStrip } from './checkin-strip';
import { FinalizedList } from './finalized-list';
import { waitMinutes } from './priority';
import { WaitingCard } from './waiting-card';
import { useHydratedNow } from '@/lib/ui/use-hydrated-now';
import { uuidv4 } from '@/lib/ui/uuid';
import styles from './consultorio.module.css';

const REFRESH_BADGE: Record<
  ConsultorioRefreshState,
  { tone: 'green' | 'amber' | 'gray'; label: string }
> = {
  active: { tone: 'green', label: 'Atualiza a cada 20 s' },
  retrying: { tone: 'amber', label: 'Tentando atualizar…' },
  paused: { tone: 'gray', label: 'Pausado em segundo plano' },
  connecting: { tone: 'gray', label: 'Atualizando…' },
};

/**
 * Cabeçalho de coluna do board. Título em texto de leitura com a contagem ao
 * lado, como na referência — o uppercase mono de 10.5px lia como etiqueta de
 * sistema, não como o nome de uma fila que a recepção acompanha o dia inteiro.
 */
function ColumnTitle({
  children,
  count,
  tone = 'default',
  hint,
}: {
  children: React.ReactNode;
  count?: number | null;
  /** `warning` marca fila com espera acima do previsto, como na referência. */
  tone?: 'default' | 'warning';
  /** Texto de contexto à direita ("maior espera 24 min", "somente leitura"). */
  hint?: React.ReactNode;
}) {
  return (
    <div className={styles.columnTitle ?? ''}>
      <h2 className="text-(length:--fs-subsection) font-semibold text-fg">{children}</h2>
      {count != null ? (
        <span
          className={cn(
            'font-mono text-(length:--fs-sm) font-semibold tabular-nums',
            tone === 'warning' ? 'text-warning-700' : 'text-fg-subtle',
          )}
        >
          {count}
        </span>
      ) : null}
      {hint ? <span className="ml-auto text-(length:--fs-2xs) text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

export function ConsultorioBoard({
  isPractitioner,
  initialBoard,
}: {
  clinicId: string;
  isPractitioner: boolean;
  initialBoard: BoardDTO;
}) {
  const [board, setBoard] = useState<BoardDTO>(initialBoard);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(
    initialBoard.activeDoctorId,
  );
  const [selectedAppt, setSelectedAppt] = useState<string | null>(
    initialBoard.emAtendimento[0]?.appointmentId ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Relógio: atualiza "tempo aguardando" sem refetch. `null` até montar (R51: o
  // `Date.now()` do servidor e o do navegador diferem e a hidratação acusava erro 418).
  const now = useHydratedNow(30_000);

  const refetch = useCallback(async (): Promise<boolean> => {
    try {
      setBoard(await getBoard({ doctorId: selectedDoctorId }));
      return true;
    } catch {
      // O hook sinaliza a falha e tenta de novo com backoff.
      return false;
    }
  }, [selectedDoctorId]);

  // Uma única fonte de atualização: leitura autorizada no servidor, de imediato
  // na montagem/troca de médico e a cada 20 s enquanto a aba está visível.
  const refreshState = useConsultorioPolling(refetch);

  // A seleção do painel central é dirigida pelo usuário (Chamar / clicar finalizada /
  // Fechar / Encerrar). Aqui só LIMPAMOS se o selecionado sumiu do board — nunca
  // auto-promovemos, senão o deselect ao Encerrar é sobrescrito a partir do board
  // ainda desatualizado (e a consulta finalizada "não fecha"). O default de montagem
  // (1º em atendimento) já vem do useState inicial.
  useEffect(() => {
    if (!selectedAppt) return;
    const onBoard = [
      ...board.aChegar,
      ...board.salaEspera,
      ...board.emAtendimento,
      ...board.finalizadas,
    ].some((c) => c.appointmentId === selectedAppt);
    if (!onBoard) setSelectedAppt(null);
  }, [board, selectedAppt]);

  const act = useCallback(
    async (id: string, fn: () => Promise<ActionResult<unknown>>) => {
      setBusyId(id);
      setError(null);
      const res = await fn();
      setBusyId(null);
      if (!res.ok) setError(res.message);
      await refetch();
      return res;
    },
    [refetch],
  );

  const onCall = (id: string) =>
    void act(id, async () => {
      const r = await callNextPatient(id, uuidv4());
      if (r.ok) setSelectedAppt(id);
      return r;
    });
  const onAbsent = (id: string) => void act(id, () => markAbsent(id, uuidv4()));
  const onCheckIn = (id: string) => void act(id, () => checkInPatient(id, uuidv4()));
  const onComplete = (id: string) =>
    void act(id, async () => {
      const r = await completeConsulta(id, uuidv4());
      if (r.ok) setSelectedAppt(null); // fecha o painel central; effect re-seleciona o próximo
      return r;
    });

  const badge = REFRESH_BADGE[refreshState];

  // Card atual (do board) do appointment selecionado → o painel central recarrega
  // quando o status muda (ex.: em_atendimento → atendido após Encerrar, ou após refetch).
  const selectedCard =
    [...board.aChegar, ...board.salaEspera, ...board.emAtendimento, ...board.finalizadas].find(
      (c) => c.appointmentId === selectedAppt,
    ) ?? null;
  const selectedStatus = selectedCard?.status ?? null;
  const viewingFinalizada = selectedStatus === 'atendido';

  // Maior espera da fila — o mesmo número que o cabeçalho da referência mostra.
  // `waitMinutes` devolve null sem check-in registrado, e aí o cabeçalho fica
  // neutro em vez de anunciar uma espera que ninguém mediu.
  const maiorEsperaMin = board.salaEspera.reduce<number | null>((maior, card) => {
    const minutos = now === null ? null : waitMinutes(card.checkInAt, now);
    if (minutos === null) return maior;
    return maior === null || minutos > maior ? minutos : maior;
  }, null);

  const diaVazio =
    board.salaEspera.length === 0 &&
    board.emAtendimento.length === 0 &&
    board.aChegar.length === 0 &&
    board.finalizadas.length === 0;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Consultório' }]}
        title="Consultório"
        description="Atenda um turno inteiro sem trocar de tela."
        meta={`${board.salaEspera.length} na fila · ${board.emAtendimento.length} em atendimento`}
        actions={
          <div className="flex items-center gap-2">
            {!isPractitioner && board.doctors.length > 0 ? (
              <Select
                value={selectedDoctorId ?? ''}
                onChange={(e) => setSelectedDoctorId(e.target.value || null)}
                className="min-w-48"
                aria-label="Selecionar médico"
              >
                {/* Item 13: sem "Todos os médicos" — o board é sempre de UM médico. */}
                {board.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome}
                  </option>
                ))}
              </Select>
            ) : null}
            <Badge tone={badge.tone} aria-live="polite">
              <RefreshCw aria-hidden="true" className="size-3 shrink-0" />
              {badge.label}
            </Badge>
            {/* A referência mantém a saída para a Agenda à mão: quando falta
                alguém, a correção do dia é lá, não aqui. */}
            <Link href="/agenda" className={buttonVariants({ variant: 'secondary' })}>
              <Calendar aria-hidden="true" className="size-4 text-fg-subtle" />
              Ver agenda
            </Link>
          </div>
        }
      />

      <CheckinStrip
        cards={board.aChegar}
        busyId={busyId}
        onCheckIn={onCheckIn}
        onAbsent={onAbsent}
      />

      {error ? (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {board.truncated ? (
        <Alert variant="warning" className="mb-4">
          Há muitos agendamentos hoje — mostrando os mais próximos (50 por coluna).
        </Alert>
      ) : null}

      {diaVazio ? (
        /* Dia sem nada: UMA frase, não quatro. Com o quadro montado, "Ninguém
           aguardando" + "Nenhum paciente em atendimento" + "Nenhuma consulta
           finalizada" + este bloco diziam a mesma coisa em quatro lugares, e
           nenhum deles explicava o que fazer. */
        <div className="qoro-fill grid place-items-center">
          <EmptyState
            title="Nada na agenda de hoje"
            description="Quando houver agendamentos para hoje, eles aparecem aqui para check-in e atendimento."
          />
        </div>
      ) : (
        <div className={cn('qoro-fill', styles.board)}>
          {/* Coluna 1 — Sala de Espera (25%) */}
          <section className={styles.waiting ?? ''}>
            <ColumnTitle
              count={board.salaEspera.length}
              tone={maiorEsperaMin !== null ? 'warning' : 'default'}
              {...(maiorEsperaMin !== null ? { hint: `maior espera ${maiorEsperaMin} min` } : {})}
            >
              Sala de espera
            </ColumnTitle>
            <div className="flex flex-col gap-2">
              {board.salaEspera.length === 0 ? (
                <p className="px-1 text-sm text-fg-subtle">Ninguém aguardando.</p>
              ) : (
                board.salaEspera.map((c) => (
                  <WaitingCard
                    key={c.appointmentId}
                    card={c}
                    now={now}
                    busy={busyId === c.appointmentId}
                    onCall={onCall}
                  />
                ))
              )}
            </div>
          </section>

          {/* Coluna 2 — Em Atendimento (50%, o coração) */}
          <section className={styles.attending ?? ''}>
            <ColumnTitle count={viewingFinalizada ? null : board.emAtendimento.length}>
              {viewingFinalizada ? 'Consulta finalizada' : 'Em atendimento'}
            </ColumnTitle>
            {!viewingFinalizada && board.emAtendimento.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {board.emAtendimento.map((c) => (
                  <button
                    key={c.appointmentId}
                    type="button"
                    onClick={() => setSelectedAppt(c.appointmentId)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm transition-colors',
                      selectedAppt === c.appointmentId
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-600/15 dark:text-primary-300'
                        : 'border-border text-fg-muted hover:bg-surface-inset',
                    )}
                  >
                    {c.pacienteNome}
                  </button>
                ))}
              </div>
            ) : null}
            <AttendingPanel
              appointmentId={selectedAppt}
              boardStatus={selectedStatus}
              checkInAt={selectedCard?.checkInAt ?? null}
              busy={busyId === selectedAppt}
              onComplete={onComplete}
              onClose={() => setSelectedAppt(null)}
              onBoardRefresh={() => void refetch()}
            />
          </section>

          {/* Coluna 3 — Finalizadas (25%) */}
          <section className={styles.finished ?? ''}>
            <ColumnTitle count={board.finalizadas.length} hint="somente leitura">
              Finalizadas
            </ColumnTitle>
            <FinalizedList
              cards={board.finalizadas}
              selectedId={selectedAppt}
              onOpen={(id) => setSelectedAppt(id)}
            />
          </section>
        </div>
      )}
    </>
  );
}
