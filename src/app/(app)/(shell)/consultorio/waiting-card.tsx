'use client';

import { TriangleAlert } from 'lucide-react';
import { memo } from 'react';

import { Avatar } from '@/components/ui/avatar';
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
}: {
  card: BoardCardDTO;
  /** `null` até montar (R51): sem número de espera até o navegador ter o próprio relógio. */
  now: number | null;
  busy: boolean;
  onCall: (id: string) => void;
}) {
  const mins = now === null ? null : waitMinutes(card.checkInAt, now);
  const tone = waitTone(mins);
  return (
    <div
      data-slot="waiting-card"
      className={cn(
        'rounded-lg border border-border border-l-4 bg-surface p-3 shadow-xs',
        LEFT_BORDER[tone],
      )}
    >
      {/* Avatar + nome + motivo, como na referência: numa fila, quem chega
          reconhece a pessoa antes de ler o horário. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={card.pacienteNome} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{card.pacienteNome}</p>
            <p className="truncate text-(length:--fs-xs) text-fg-muted">
              {[demographicsLine(card.idade, card.sexo), card.motivo].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {card.urgencia ? <Badge tone="red">Urgência</Badge> : null}
      </div>

      {/* Horário à esquerda, espera à direita — a referência põe os dois na
          mesma linha porque a leitura é "marcado para X, esperando há Y". */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-(length:--fs-xs)">
        <span className="text-fg-muted tabular-nums">{formatHora(card.horario)}</span>
        <Badge tone={WAIT_BADGE[tone]} dot>
          {formatWait(mins)} aguardando
        </Badge>
      </div>

      {card.queuePosition != null ? (
        <p className="mt-1.5 text-(length:--fs-xs) text-fg-subtle">
          {card.queuePosition}º na fila · previsão inicial de {card.estimatedWaitMinutes ?? 0} min
        </p>
      ) : null}

      {card.alergias.length > 0 ? (
        <p className="mt-2 flex items-start gap-1 text-(length:--fs-xs) text-danger-700">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <b>Alergias:</b> {card.alergias.join(', ')}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-(length:--fs-xs) text-fg-subtle">Sem alergias registradas</p>
      )}

      <div className="mt-3 flex gap-2">
        {/* Largura total: é a única ação do card e a fila é operada com pressa —
            alvo grande economiza mira. */}
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          loading={busy}
          onClick={() => onCall(card.appointmentId)}
        >
          Chamar
        </Button>
        {/* STATE-001 — `chegou → faltou` NÃO é transição válida. O botão
            existia aqui e a action respondia "esta ação não é mais possível"
            com HTTP 200 e zero persistência: um controle semanticamente
            impossível oferecido logo depois de registrar que o paciente
            chegou. A ação de falta vive em "A chegar". */}
      </div>
    </div>
  );
}

export const WaitingCard = memo(WaitingCardImpl);
