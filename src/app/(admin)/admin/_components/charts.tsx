import type { CSSProperties } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Helpers visuais do console — recriados em Tailwind com a paleta viz do DS v2
 * (ADR-031). Sem lib de gráfico; sem dados fake.
 */

export interface Bar {
  label: string;
  /** altura 0–100 (% da escala). */
  value: number;
  /** destaca a barra (série corrente). */
  on?: boolean;
}

/** Gráfico de barras — DS v2 §barchart (viz-1; corrente em viz-8). */
export function Bars({ data }: { data: Bar[] }) {
  return (
    <div className="flex h-40 gap-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full flex-1 items-end">
            <div
              className={cn('w-full rounded-t-(--r-xs)', d.on ? 'bg-viz-8' : 'bg-viz-1')}
              style={{ height: `${Math.max(0, Math.min(100, d.value))}%` }}
            />
          </div>
          {d.label ? (
            <span className="font-mono text-(length:--fs-2xs) text-fg-subtle uppercase">
              {d.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export interface Seg {
  color: string;
  value: number;
  label: string;
}

/** Donut (conic-gradient) — DS v2 §donut. `value` é a fatia (proporcional). */
export function Donut({ segments }: { segments: Seg[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  const stops = segments
    .map((s) => {
      const a = (acc / total) * 100;
      acc += s.value;
      const b = (acc / total) * 100;
      return `${s.color} ${a}% ${b}%`;
    })
    .join(', ');
  return (
    <div
      aria-hidden="true"
      className="size-32 rounded-full [mask:radial-gradient(circle_at_center,transparent_38%,#000_39%)]"
      style={{ background: `conic-gradient(${stops})` }}
    />
  );
}

/** Legenda do donut — % de cada fatia. */
export function Legend({ segments }: { segments: Seg[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      {segments.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-(length:--fs-sm) text-fg-muted">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: s.color }}
          />
          {s.label}
          <span className="ml-auto font-mono text-(length:--fs-xs) text-fg-subtle">
            {Math.round((s.value / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** Chip de iniciais da clínica (tom via `--mk`). */
export function ClinicMark({ nome, tint }: { nome: string; tint?: string }) {
  const init =
    nome
      .trim()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .slice(0, 2)
      .toUpperCase() || '??';
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-(--r-sm) text-[10.5px] font-bold text-neutral-0"
      style={{ background: (tint ?? 'var(--primary-500)') as CSSProperties['background'] }}
    >
      {init}
    </span>
  );
}
