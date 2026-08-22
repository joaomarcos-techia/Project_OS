import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

type FieldProps = {
  label?: ReactNode;
  htmlFor?: string;
  /**
   * Use para conjuntos de controles relacionados (radio group, checkboxes etc.).
   * Nesse modo o rótulo vira um `legend`, em vez de um `label` sem controle.
   */
  group?: boolean;
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
export function Field({
  label,
  htmlFor,
  group = false,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const content = (
    <>
      {label ? (
        group ? (
          <legend className="text-(length:--fs-sm) font-medium text-fg">
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-1.5 text-danger-600">
                *
              </span>
            ) : null}
          </legend>
        ) : (
          <label
            id={htmlFor ? `${htmlFor}-label` : undefined}
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
        )
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
    </>
  );

  if (group) {
    return (
      <fieldset
        className={cn('m-0 flex min-w-0 flex-col gap-(--field-gap) border-0 p-0', className)}
      >
        {content}
      </fieldset>
    );
  }

  return <div className={cn('flex flex-col gap-(--field-gap)', className)}>{content}</div>;
}
