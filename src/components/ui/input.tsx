import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

type InputProps = ComponentProps<'input'> & { invalid?: boolean };

/** Input de texto — DS §08.9. */
export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      data-invalid={invalid || undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm text-fg',
        'transition-[border-color,box-shadow] duration-[120ms] placeholder:text-fg-subtle',
        'focus:border-primary-500 focus:outline-none focus:ring-[3px] focus:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'data-[invalid]:border-danger-500 data-[invalid]:focus:ring-danger-500/25',
        className,
      )}
      {...props}
    />
  );
}
