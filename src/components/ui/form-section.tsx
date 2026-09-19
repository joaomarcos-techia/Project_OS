import type { ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Grupo de campos com rótulo — as seções IDENTIFICAÇÃO / CONTATO / PROFISSIONAL
 * dos drawers da referência.
 *
 * É `<fieldset>` com `<legend>`, não `<div>` + `<span>`: leitor de tela anuncia
 * a legenda ao entrar em cada campo do grupo, então "Nome" vira "Identificação,
 * Nome". Num drawer com três grupos de campos curtos, é a diferença entre saber
 * e não saber em que parte do formulário se está.
 */
export function FormSection({
  label,
  helper,
  children,
  className,
}: {
  label: ReactNode;
  /** Nota abaixo dos campos — explica a consequência, não repete o rótulo. */
  helper?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset data-slot="form-section" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <legend className="mb-1 text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase">
        {label}
      </legend>
      {children}
      {helper ? <p className="text-(length:--fs-xs) text-fg-subtle">{helper}</p> : null}
    </fieldset>
  );
}
