'use client';

/**
 * UX-003 — identificação e cancelamento de uma série recorrente.
 *
 * A criação recorrente gera até 104 consultas e a Agenda mostrava cada uma como
 * isolada: sem indicador de origem, sem saber quantas existem, e sem nenhuma
 * forma de interromper as futuras — restava corrigir item a item, com risco de
 * omissão e a série ainda marcada como ativa.
 *
 * O diálogo declara exatamente o que será atingido ANTES de confirmar, porque
 * "cancelar a série" é uma ação de alcance muito maior do que o clique sugere.
 */
import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useActionFeedback } from '@/components/ui/use-action-feedback';
import type { RecurrenceSeriesSummary } from '@/contexts/scheduling/queries';
import { uuidv4 } from '@/lib/ui/uuid';

import { cancelarSerieRecorrenteAction, type AgendaOperationState } from './actions';

export function RecurrenceSeriesDialog({
  series,
  occurrence,
}: {
  series: RecurrenceSeriesSummary;
  /** Posição desta consulta na série (1-based). */
  occurrence: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(uuidv4);
  const [state, action, pending] = useActionState<AgendaOperationState, FormData>(
    cancelarSerieRecorrenteAction,
    null,
  );
  const reasonId = useId();

  useActionFeedback(state, (result) =>
    result === null
      ? null
      : result.ok
        ? { type: 'success', title: 'Série encerrada', description: result.message }
        : {
            type: 'error',
            title: 'Não foi possível cancelar a série',
            description: result.message,
          },
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      // Chave nova depois do sucesso: a próxima tentativa é uma operação nova,
      // não o replay da anterior.
      setIdempotencyKey(uuidv4());
      router.refresh();
    }
  }, [state, router]);

  const label =
    occurrence === null
      ? `Série de ${series.occurrences}`
      : `Série ${occurrence}/${series.occurrences}`;
  const cadence = series.intervalWeeks === 1 ? 'semanal' : `a cada ${series.intervalWeeks} semanas`;

  // Série já encerrada continua VISÍVEL (o vínculo é histórico), mas sem ação.
  if (series.status !== 'active') {
    return (
      <span
        className="rounded-(--r-xs) bg-surface-inset px-1.5 py-0.5 text-(length:--fs-2xs) text-fg-subtle"
        title={`Série ${cadence} encerrada`}
      >
        {label} · encerrada
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-(--r-xs) bg-surface-inset px-1.5 py-0.5 text-(length:--fs-2xs) text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          title={`Consulta recorrente ${cadence}. Clique para gerenciar a série.`}
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <input type="hidden" name="seriesId" value={series.id} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <DialogHeader>
            <DialogTitle>Cancelar a série recorrente</DialogTitle>
            <DialogDescription>
              Série {cadence} de {series.occurrences} consultas.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <p className="text-(length:--fs-sm)">
              {series.futureActive === 0 ? (
                <>
                  Não há consultas futuras ativas nesta série. Encerrar apenas marca a série como
                  cancelada; o histórico permanece intacto.
                </>
              ) : (
                <>
                  <b>{series.futureActive}</b> consulta(s) futura(s) ser(ão) cancelada(s). As
                  consultas já realizadas ou passadas <b>não</b> são alteradas.
                </>
              )}
            </p>
            <Field label="Motivo" htmlFor={reasonId}>
              <Textarea
                id={reasonId}
                name="reason"
                rows={3}
                required
                maxLength={500}
                placeholder="Por que a série está sendo interrompida?"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Cancelar série
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
