import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Separator compatível com a anatomia shadcn, sem dependência adicional. */
export function Separator({
  orientation = 'horizontal',
  decorative = true,
  className,
  ...props
}: ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      data-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}
