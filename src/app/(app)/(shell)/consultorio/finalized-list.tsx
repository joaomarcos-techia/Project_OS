'use client';

import { cn } from '@/lib/ui/cn';

import type { BoardCardDTO } from './board-types';
import { formatHora } from './format';

/**
 * Finalizadas (atendido, hoje). Reabertura = SOMENTE LEITURA: clicar carrega o
 * prontuário assinado no centro em modo read-only. NÃO reabre o atendimento.
 */
export function FinalizedList({
  cards,
  selectedId,
  onOpen,
}: {
  cards: BoardCardDTO[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  if (cards.length === 0) {
    return <p className="px-1 text-sm text-fg-subtle">Nenhuma consulta finalizada hoje.</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {cards.map((c) => (
        <li key={c.appointmentId}>
          <button
            type="button"
            onClick={() => onOpen(c.appointmentId)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-inset',
              selectedId === c.appointmentId && 'bg-surface-inset',
            )}
          >
            <span className="font-mono text-xs text-fg-subtle">{formatHora(c.horario)}</span>
            <span className="truncate font-medium">{c.pacienteNome}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
