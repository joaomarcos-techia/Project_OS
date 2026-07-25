'use client';

import { TriangleAlert } from 'lucide-react';
import { memo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/ui/cn';

import { demographicsLine } from './board-logic';
import type { BoardCardDTO } from './board-types';
import { formatHora } from './format';
import { formatWait, waitMinutes, waitTone, type WaitTone } from './priority';

const LEFT_BORDER: Record<WaitTone, string> = {
  normal: 'border-l-border',
  attention: 'border-l-warning-500',
  critical: 'border-l-danger-500',
};
const WAIT_BADGE: Record<WaitTone, 'gray' | 'amber' | 'red'> = {
  normal: 'gray',
  attention: 'amber',
  critical: 'red',
};

function WaitingCardImpl({
  card,
  now,
  busy,
  onCall,
  onAbsent,
}: {
  card: BoardCardDTO;
  now: number;
  busy: boolean;
  onCall: (id: string) => void;
  onAbsent: (id: string) => void;
}) {
  const mins = waitMinutes(card.checkInAt, now);
  const tone = waitTone(mins);
  return (
    <div className={cn('rounded-lg border border-border border-l-4 bg-surface p-3 shadow-xs', LEFT_BORDER[tone])}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{card.pacienteNome}</p>
          {demographicsLine(card.idade, card.sexo) ? (
            <p className="truncate text-xs text-fg-subtle">{demographicsLine(card.idade, card.sexo)}</p>
          ) : null}
          <p className="truncate text-xs text-fg-muted">
            {formatHora(card.horario)} · {card.motivo}
          </p>
        </div>
        {card.urgencia ? <Badge tone="red">Urgência</Badge> : null}
      </div>

      <div className="mt-2">
        <Badge tone={WAIT_BADGE[tone]} dot>
          {formatWait(mins)} aguardando
        </Badge>
        {card.queuePosition != null ? (
          <span className="ml-2 text-xs text-fg-muted">
            {card.queuePosition}º na fila · previsão inicial de {card.estimatedWaitMinutes ?? 0} min
          </span>
        ) : null}
      </div>

      {card.alergias.length > 0 ? (
        <p className="mt-2 flex items-start gap-1 text-xs text-danger-700">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <b>Alergias:</b> {card.alergias.join(', ')}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-xs text-fg-subtle">Sem alergias registradas</p>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={() => onCall(card.appointmentId)}>
          Chamar
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAbsent(card.appointmentId)}>
          Marcar ausente
        </Button>
      </div>
    </div>
  );
}

export const WaitingCard = memo(WaitingCardImpl);
