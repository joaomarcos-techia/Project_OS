import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Classes base dos controles de formulário — DS v2 §fields.
 * Compartilhadas por Input/Textarea/Select/DateField.
 */
/**
 * Matriz de estados dos controles — DS v2 §fields.
 *
 * Preenchido e sem borda em repouso (§referencia). Sem borda para reforcar, o
 * foco vira a unica affordance de interacao — por isso troca o fundo para
 * --surface E acende a borda primaria.
 *
 * A divisao entre `focus` e `focus-visible` e proposital e preexistente: borda e
 * fundo respondem a QUALQUER foco (inclusive clique, e inclusive no <select>
 * nativo, onde focus-visible nao dispara no mouse), enquanto o anel de 3px fica
 * so no foco por teclado, que e quem precisa dele.
 */
export const fieldControlClassName = cn(
  'w-full appearance-none rounded-(--field-radius) border border-(--field-border) bg-(--field-bg)',
  'h-(--control-h) min-h-(--hit-target) px-(--control-px) text-(length:--control-fs) text-(--field-text)',
  'transition-[border-color,box-shadow,background-color] duration-(--dur-fast)',
  'placeholder:text-(--field-placeholder)',
  'hover:border-(--field-border-hover) hover:bg-(--field-bg-hover)',
  'focus:border-(--field-border-focus) focus:bg-(--field-bg-focus) focus:outline-none',
  'focus-visible:shadow-[0_0_0_3px_var(--field-ring-focus)]',
  'read-only:bg-(--surface-2) read-only:text-fg-muted read-only:shadow-none',
  'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-inset disabled:text-fg-subtle',
);

export const fieldControlInvalidClassName = cn(
  'border-danger-500 hover:border-danger-500',
  'focus:border-danger-500 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklch,var(--danger-500)_20%,transparent)]',
);

type InputProps = ComponentProps<'input'> & { invalid?: boolean };

/** Input de texto — DS v2 §fields, recriado em Tailwind. */
export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(fieldControlClassName, invalid && fieldControlInvalidClassName, className)}
      {...props}
    />
  );
}
