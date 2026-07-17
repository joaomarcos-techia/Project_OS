import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Grupo de botões colados — DS v2 §btn-group. Filhos: <Button>/<Link> estilizado. */
export function ButtonGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="group"
      className={cn(
        'inline-flex -space-x-px',
        '[&>*]:rounded-none [&>*]:shadow-none [&>*:hover]:z-10 [&>*:focus-visible]:z-10',
        '[&>*:first-child]:rounded-l-(--btn-radius) [&>*:last-child]:rounded-r-(--btn-radius)',
        className,
      )}
      {...props}
    />
  );
}
