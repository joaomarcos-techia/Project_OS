import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/ui/cn';

import type { ActivationChecklistDTO } from '../data';

/** Checklist de ativação (Fase 2) — some quando os passos estão concluídos. */
export function ActivationChecklist({ data }: { data: ActivationChecklistDTO }) {
  if (data.complete) return null;
  return (
    <Card className="mb-(--sp-4) border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_4%,var(--surface))] p-(--sp-4)">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h4 className="text-(length:--fs-sm) font-semibold">Primeiros passos</h4>
        <span className="font-mono text-(length:--fs-2xs) text-fg-subtle">
          {data.done}/{data.total} concluídos
        </span>
      </div>
      <p className="mb-3 text-(length:--fs-sm) text-fg-muted">
        Falta pouco para sua clínica funcionar 100%.
      </p>
      <ul className="flex flex-col">
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
                  it.done ? 'bg-success-500 text-neutral-0' : 'border-[1.5px] border-border-strong',
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
    </Card>
  );
}
