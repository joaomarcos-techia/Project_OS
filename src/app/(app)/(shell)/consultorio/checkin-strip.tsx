'use client';

import { Button } from '@/components/ui/button';

import { canMarkNoShow } from './board-logic';
import type { BoardCardDTO } from './board-types';
import { formatHora } from './format';

/**
 * Faixa "A chegar hoje" — pré-passo de check-in acima do kanban.
 *
 * É a SEGUNDA BARRA do shell (56px, sangrando até as bordas), e não um cartão
 * dentro do conteúdo: quem ainda não chegou não faz parte do turno em andamento,
 * faz parte do controle do dia — mesmo lugar onde a Agenda põe o seletor de data
 * e o Financeiro põe os filtros.
 *
 * Cada pessoa é uma ficha de uma linha só: hora, nome e as duas saídas
 * possíveis. Sem motivo e sem segunda linha — a ficha existe para ser despachada
 * em um clique, e o que a recepção precisa para isso é "quem" e "quando".
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
    <div className="qoro-toolbar" aria-label="A chegar hoje">
      <span className="text-(length:--fs-2xs) font-semibold tracking-(--tracking-label) text-fg-subtle uppercase">
        A chegar hoje
      </span>
      <span className="font-mono text-(length:--fs-caption) font-semibold tabular-nums text-fg-subtle">
        {cards.length}
      </span>
      {cards.map((c) => (
        <div
          key={c.appointmentId}
          className="flex shrink-0 items-center gap-2.5 rounded-(--r-sm) border border-border bg-surface py-0 pr-2 pl-3"
        >
          <span className="font-mono text-(length:--fs-caption) font-semibold tabular-nums text-fg-muted">
            {formatHora(c.horario)}
          </span>
          <span className="max-w-52 truncate text-(length:--fs-sm) font-medium text-fg">
            {c.pacienteNome}
          </span>
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
      ))}
    </div>
  );
}
