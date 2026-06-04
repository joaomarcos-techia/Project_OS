'use client';

import { Button } from '@/components/ui/button';

import type { BoardCardDTO } from './board-types';
import { formatHora } from './format';

/**
 * Faixa "A chegar hoje" — pré-passo de check-in acima do kanban (não existe tela
 * de Agenda ainda). Os 3 kanban columns ficam intactos; aqui só transicionamos
 * agendado/confirmado → chegou.
 */
export function CheckinStrip({
  cards,
  busyId,
  onCheckIn,
}: {
  cards: BoardCardDTO[];
  busyId: string | null;
  onCheckIn: (id: string) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3">
      <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.09em] text-fg-subtle">
        A chegar hoje · {cards.length}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cards.map((c) => (
          <div
            key={c.appointmentId}
            className="flex min-w-56 shrink-0 items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{c.pacienteNome}</p>
              <p className="truncate text-xs text-fg-muted">
                {formatHora(c.horario)} · {c.motivo}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === c.appointmentId}
              onClick={() => onCheckIn(c.appointmentId)}
            >
              Check-in
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
