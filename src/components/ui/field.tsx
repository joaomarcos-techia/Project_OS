import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

type FieldProps = {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Agrupa label + controle + hint/erro — classe do Design System (`ds.css` `.field`). */
export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn('field', className)}>
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? (
        <p style={{ fontSize: '12.5px', color: 'var(--danger-600)' }}>{error}</p>
      ) : hint ? (
        <p style={{ fontSize: '12.5px', color: 'var(--text-3)' }}>{hint}</p>
      ) : null}
    </div>
  );
}
