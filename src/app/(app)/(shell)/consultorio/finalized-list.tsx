'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/ui/cn';

import type { BoardCardDTO } from './board-types';
import { formatHora } from './format';

/**
 * Finalizadas (atendido, hoje) — lista compacta. Reabertura = SOMENTE LEITURA:
 * clicar carrega o prontuário assinado no centro. NÃO reabre o atendimento.
 * Anti-vazamento: consulta finalizada com pendência de cobrança aberta ganha
 * destaque — dinheiro não pode escapar em silêncio.
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
    <ul className="flex flex-col gap-2">
      {cards.map((c) => (
        <li key={c.appointmentId}>
          <button
            type="button"
            onClick={() => onOpen(c.appointmentId)}
            className={cn(
              'w-full rounded-(--r-md) border border-border bg-surface p-3 text-left shadow-xs transition-colors hover:bg-surface-hover',
              selectedId === c.appointmentId && 'border-ring bg-surface-inset',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-fg-subtle">{formatHora(c.horario)}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {c.pacienteNome}
              </span>
            </span>
            <span className="mt-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-fg-subtle">{c.motivo}</span>
              {c.cobrancaPendente ? (
                <Badge tone="amber" dot>
                  Sem cobrança
                </Badge>
              ) : (
                <Badge tone="green" dot>
                  Faturada
                </Badge>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
