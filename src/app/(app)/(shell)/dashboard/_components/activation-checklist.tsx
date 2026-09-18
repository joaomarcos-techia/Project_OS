import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/ui/cn';

import type { ActivationChecklistDTO } from '../data';

import { ChecklistDismiss } from './checklist-dismiss';

/**
 * Checklist de ativação (Fase 2) — some quando os passos estão concluídos.
 *
 * O-7: some também quando a pessoa dispensa. São duas razões diferentes para o
 * mesmo desaparecimento — "a clínica terminou" é fato derivado do banco, "não
 * quero mais ver" é escolha de quem usa. Dispensar não marca nada como feito.
 */
export function ActivationChecklist({
  data,
  dismissed = false,
}: {
  data: ActivationChecklistDTO;
  dismissed?: boolean;
}) {
  if (data.complete || dismissed) return null;
  const pending = data.items.find((item) => !item.done);
  return (
    <Card className="mb-3.5 overflow-hidden">
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-(length:--fs-sm) focus-visible:shadow-(--focus-ring) focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="font-semibold">Ativação da clínica</span>
          <span className="font-mono text-(length:--fs-xs) text-fg-subtle tabular-nums">
            {data.done} de {data.total}
          </span>
          <span aria-hidden="true" className="h-1 w-20 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${data.total > 0 ? (data.done / data.total) * 100 : 0}%` }}
            />
          </span>
          <span className="min-w-0 flex-1 basis-full text-pretty text-(length:--fs-xs) text-fg-muted sm:basis-auto">
            {pending?.desc ?? 'Confira os passos de ativação.'}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-180"
          />
        </summary>
        {/* Fora do <summary>: dentro dele, o clique no botão também abriria e
            fecharia o <details>, e dispensar viraria um gesto duplo. */}
        <div className="flex justify-end border-t border-border px-4 pt-2">
          <ChecklistDismiss />
        </div>
        <ul className="flex flex-col px-4 py-1">
          {data.items.map((it) => (
            <li key={it.key} className="border-b border-border last:border-b-0">
              <Link
                href={it.href}
                className={cn(
                  'flex items-center gap-3 rounded-(--r-sm) px-1 py-2.5 transition-colors hover:bg-surface-hover',
                  it.done && 'opacity-55',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-5.5 shrink-0 place-items-center rounded-full',
                    it.done
                      ? 'bg-success-500 text-neutral-0'
                      : 'border-[1.5px] border-border-strong',
                  )}
                >
                  {it.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-(length:--fs-sm) font-medium',
                      it.done && 'line-through',
                    )}
                  >
                    {it.label}
                  </span>
                  <span className="block text-(length:--fs-xs) text-fg-subtle">{it.desc}</span>
                </span>
                {!it.done ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
