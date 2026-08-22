'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

export type SegmentedOption<V extends string> = { value: V; label: ReactNode };

/** Controle segmentado — DS v2 (§segmented). Para 2–4 opções mutuamente exclusivas. */
export function Segmented<V extends string>({
  options,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  className,
}: {
  options: SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  'aria-label'?: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex gap-0.5 rounded-(--r-md) border border-border bg-surface-inset p-0.75',
        className,
      )}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              'h-[calc(var(--control-h)-8px)] rounded-(--r-sm) px-3.5 text-(length:--fs-sm) font-medium transition-[background-color,color,box-shadow] duration-(--dur-fast)',
              'focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
              on ? 'bg-surface text-fg shadow-(--elev-raised)' : 'text-fg-muted hover:text-fg',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
