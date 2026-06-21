import type { ReactNode } from 'react';

import { Icon } from '@/components/painel/icons';

/**
 * Stat tile do console — porte do helper `stat()` do design bundle. `icon`/`tone`
 * renderizam o chip `.st-ico`; `delta`/`deltaTone` ('up'|'down') renderizam a
 * variação `.st-d` colorida; `hint` é a variação neutra (fallback).
 */
export function StatCard({
  label,
  value,
  hint,
  delta,
  deltaTone,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: ReactNode;
  deltaTone?: 'up' | 'down';
  icon?: string;
  tone?: 'teal' | 'green' | 'amber' | 'red';
}) {
  const d = delta ?? hint;
  return (
    <div className="stat-tile">
      <div className="st-top">
        <span className="st-l">{label}</span>
        {icon ? (
          <span className={`st-ico${tone ? ` ${tone}` : ''}`}>
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <div className="st-v">{value}</div>
      {d ? <div className={`st-d${delta && deltaTone ? ` ${deltaTone}` : ''}`}>{d}</div> : null}
    </div>
  );
}
