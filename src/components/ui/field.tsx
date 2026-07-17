import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

type FieldProps = {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Agrupa label + controle + hint/erro — DS v2 §fields.
 * Erro substitui o hint (comportamento do DS: `.field.invalid`).
 */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-(--field-gap)', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1.5 text-(length:--fs-sm) font-medium text-fg"
        >
          {label}
          {required ? (
            <span aria-hidden="true" className="text-danger-600">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-center gap-1.25 text-(length:--fs-xs) text-danger-600">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-(length:--fs-xs) text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
