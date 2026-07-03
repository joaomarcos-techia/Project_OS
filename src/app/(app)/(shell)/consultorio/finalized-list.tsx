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
    <ul className="flex flex-col gap-0.5">
      {cards.map((c) => (
        <li key={c.appointmentId}>
          <button
            type="button"
            onClick={() => onOpen(c.appointmentId)}
            className={cn(
              'flex w-full items-center gap-2 rounded-(--r-sm) px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-hover',
              selectedId === c.appointmentId && 'bg-surface-inset',
            )}
          >
            <span className="font-mono text-xs text-fg-subtle">{formatHora(c.horario)}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{c.pacienteNome}</span>
            {c.cobrancaPendente ? (
              <Badge tone="amber" dot>
                Sem cobrança
              </Badge>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
