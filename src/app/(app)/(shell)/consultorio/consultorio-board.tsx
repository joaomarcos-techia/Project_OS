'use client';

import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/ui/cn';
import {
  useConsultorioRealtime,
  type RealtimeState,
} from '@/lib/realtime/use-consultorio-realtime';

import { callNextPatient, checkInPatient, completeConsulta, getBoard, markAbsent } from './actions';
import { AttendingPanel } from './attending-panel';
import type { ActionResult, BoardDTO } from './board-types';
import { CheckinStrip } from './checkin-strip';
import { FinalizedList } from './finalized-list';
import { WaitingCard } from './waiting-card';
import { uuidv4 } from '@/lib/ui/uuid';

const CONN_BADGE: Record<RealtimeState, { tone: 'green' | 'amber' | 'gray'; label: string }> = {
  live: { tone: 'green', label: 'Tempo real' },
  polling: { tone: 'amber', label: 'Reconectando…' },
  connecting: { tone: 'gray', label: 'Conectando…' },
};

/**
 * Cabeçalho de coluna do board. Título em texto de leitura com a contagem ao
 * lado, como na referência — o uppercase mono de 10.5px lia como etiqueta de
 * sistema, não como o nome de uma fila que a recepção acompanha o dia inteiro.
 */
function ColumnTitle({ children, count }: { children: React.ReactNode; count?: number | null }) {
  return (
    <div className="mb-(--sp-3) flex items-center gap-2 px-1">
      <h2 className="text-(length:--fs-subsection) font-semibold text-fg">{children}</h2>
      {count != null ? (
        <span className="min-w-5 rounded-full bg-surface-inset px-1.5 py-0.5 text-center text-(length:--fs-xs) font-medium text-fg-muted tabular-nums">
          {count}
        </span>
      ) : null}
    </div>
  );
}

export function ConsultorioBoard({
  clinicId,
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
  const [now, setNow] = useState(() => Date.now());

  // Relógio: atualiza "tempo aguardando" sem refetch.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const refetch = useCallback(async () => {
    try {
      setBoard(await getBoard({ doctorId: selectedDoctorId }));
    } catch {
      // getBoard só lança em auth; Realtime/polling tentará de novo.
    }
  }, [selectedDoctorId]);

  const conn = useConsultorioRealtime({ clinicId, tables: ['appointments'], onChange: refetch });

  // Troca de médico (gestor/atendente) → refetch.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Rede de segurança: polling lento (20s) APENAS quando o Realtime não está ao
  // vivo. Com o canal "live", o Realtime entrega as mudanças e o próprio hook tem
  // backoff se cair — então não há getBoard ocioso a cada 20s (board mais leve).
  useEffect(() => {
    if (conn === 'live') return;
    const t = setInterval(() => void refetch(), 20_000);
    return () => clearInterval(t);
  }, [conn, refetch]);

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

  const badge = CONN_BADGE[conn];

  // Card atual (do board) do appointment selecionado → o painel central recarrega
  // quando o status muda (ex.: em_atendimento → atendido após Encerrar, ou via Realtime).
  const selectedCard =
    [...board.aChegar, ...board.salaEspera, ...board.emAtendimento, ...board.finalizadas].find(
      (c) => c.appointmentId === selectedAppt,
    ) ?? null;
  const selectedStatus = selectedCard?.status ?? null;
  const viewingFinalizada = selectedStatus === 'atendido';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Consultório' }]}
        title="Consultório"
        description="Atenda um turno inteiro sem trocar de tela."
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
            <Badge tone={badge.tone} dot>
              {badge.label}
            </Badge>
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

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr_1fr]">
        {/* Coluna 1 — Sala de Espera (25%) */}
        <section>
          <ColumnTitle count={board.salaEspera.length}>Sala de espera</ColumnTitle>
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
        <section className="flex flex-col gap-3">
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
        <section>
          <ColumnTitle count={board.finalizadas.length}>Finalizadas</ColumnTitle>
          <FinalizedList
            cards={board.finalizadas}
            selectedId={selectedAppt}
            onOpen={(id) => setSelectedAppt(id)}
          />
        </section>
      </div>

      {board.salaEspera.length === 0 &&
      board.emAtendimento.length === 0 &&
      board.aChegar.length === 0 &&
      board.finalizadas.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nada na agenda de hoje"
            description="Quando houver agendamentos para hoje, eles aparecem aqui para check-in e atendimento."
          />
        </div>
      ) : null}
    </>
  );
}
