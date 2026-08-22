import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Classes base dos controles de formulário — DS v2 §fields.
 * Compartilhadas por Input/Textarea/Select/DateField.
 */
export const fieldControlClassName = cn(
  'w-full appearance-none rounded-(--field-radius) border border-(--field-border) bg-(--field-bg)',
  'h-(--control-h) min-h-(--hit-target) px-(--control-px) text-(length:--control-fs) text-(--field-text)',
  'transition-[border-color,box-shadow,background] duration-(--dur-fast)',
  'placeholder:text-(--field-placeholder)',
  'hover:border-border-strong',
  'focus:border-(--ring) focus:bg-surface focus:outline-none',
  'focus-visible:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)]',
  'disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-fg-subtle',
);

export const fieldControlInvalidClassName = cn(
  'border-danger-500',
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
