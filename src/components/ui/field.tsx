import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';
import { Label } from './label';

type FieldProps = {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** Agrupa label + controle + hint/erro (DS §08.9, `.field`). */
export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? <Label htmlFor={htmlFor}>{label}</Label> : null}
      {children}
      {error ? (
        <p className="text-[12.5px] text-danger-600">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
