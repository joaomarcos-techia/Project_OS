import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean };

/** Textarea — classe do Design System (`ds.css` `.textarea`). */
export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn('textarea', invalid && 'invalid', className)}
      {...props}
    />
  );
}
