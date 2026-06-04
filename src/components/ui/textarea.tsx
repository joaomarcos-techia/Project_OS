import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean };

/** Textarea — DS §08.9 (min-height + resize vertical). */
export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      data-invalid={invalid || undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-[84px] w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm leading-[1.55] text-fg',
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
