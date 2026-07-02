import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';
import { fieldControlClassName, fieldControlInvalidClassName } from './input';

type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean };

/** Textarea — DS v2 §fields, recriado em Tailwind. */
export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        fieldControlClassName,
        'h-auto min-h-20 resize-y py-2.5 leading-normal',
        invalid && fieldControlInvalidClassName,
        className,
      )}
      {...props}
    />
  );
}
