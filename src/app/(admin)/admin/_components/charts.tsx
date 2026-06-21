import type { CSSProperties } from 'react';

/**
 * Helpers visuais do console (porte 1:1 de `app/helpers.js` do design bundle) —
 * `.chart`/`.bars`, `.donut`/`.legend` e o chip de iniciais `.clinic-mk`. Todo o
 * CSS já vive em ds.css/app-shell.css; aqui só o markup, sem dados fake.
 */

export interface Bar {
  label: string;
  /** altura 0–100 (% da escala). */
  value: number;
  /** destaca a barra (gradiente de acento). */
  on?: boolean;
}

/** Gráfico de barras — DS `.chart`/`.bars`. `data` já normalizado em 0–100. */
export function Bars({ data }: { data: Bar[] }) {
  return (
    <div className="chart">
      <div className="chart-grid">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="bars">
        {data.map((d, i) => (
          <div className="bar-col" key={i}>
            <div
              className="bar-v"
              style={{
                height: `${Math.max(0, Math.min(100, d.value))}%`,
                ...(d.on
                  ? { background: 'linear-gradient(var(--accent-400), var(--accent-600))' }
                  : {}),
              }}
            />
            {d.label ? <span className="bar-l">{d.label}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface Seg {
  color: string;
  value: number;
  label: string;
}

/** Donut (conic-gradient) — DS `.donut`. `value` é a fatia (proporcional). */
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
  return <div className="donut" style={{ background: `conic-gradient(${stops})` }} />;
}

/** Legenda do donut — DS `.legend`. Mostra o % de cada fatia. */
export function Legend({ segments }: { segments: Seg[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="legend">
      {segments.map((s, i) => (
        <div className="legend-row" key={i}>
          <span className="lg-dot" style={{ background: s.color }} />
          {s.label}
          <span className="lg-v">{Math.round((s.value / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/** Chip de iniciais da clínica — DS `.clinic-mk` (tom via `--mk`). */
export function ClinicMark({ nome, tint }: { nome: string; tint?: string }) {
  const init = nome.trim().replace(/[^\p{L}\p{N}\s]/gu, '').slice(0, 2).toUpperCase() || '??';
  return (
    <span className="clinic-mk" style={{ '--mk': tint ?? 'var(--primary-500)' } as CSSProperties}>
      {init}
    </span>
  );
}
