'use client';

import { Button } from '@/components/ui/button';

import { canMarkNoShow } from './board-logic';
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
  onAbsent,
}: {
  cards: BoardCardDTO[];
  busyId: string | null;
  onCheckIn: (id: string) => void;
  /** STATE-001 — falta só é transição válida ANTES do check-in. */
  onAbsent: (id: string) => void;
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
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === c.appointmentId}
                onClick={() => onCheckIn(c.appointmentId)}
              >
                Check-in
              </Button>
              {/* STATE-001 — `agendado`/`confirmado → faltou` é válido; era aqui
                  que o botão faltava. Derivado da máquina de estados. */}
              {canMarkNoShow(c.status) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === c.appointmentId}
                  onClick={() => onAbsent(c.appointmentId)}
                >
                  Faltou
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
