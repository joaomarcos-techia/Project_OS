import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

type InputProps = ComponentProps<'input'> & { invalid?: boolean };

/** Input de texto — classe do Design System (`ds.css` `.input`). */
export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn('input', invalid && 'invalid', className)}
      {...props}
    />
  );
}
