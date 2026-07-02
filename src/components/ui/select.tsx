import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';
import { fieldControlClassName, fieldControlInvalidClassName } from './input';

type SelectProps = ComponentProps<'select'> & { invalid?: boolean };

/**
 * Select nativo estilizado — DS v2 §fields. O chevron é um ícone posicionado
 * (o wrapper se comporta como o select em layout: inline-flex + w-full).
 * API inalterada (todos os props nativos passam adiante).
 */
export function Select({ className, invalid, ...props }: SelectProps) {
  return (
    <span className="relative inline-flex w-full">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          fieldControlClassName,
          'cursor-pointer pr-8',
          invalid && fieldControlInvalidClassName,
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle"
      />
    </span>
  );
}
