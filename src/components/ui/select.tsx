import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Select nativo estilizado — DS §08.9 (chevron como overlay, theme-aware). */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'w-full cursor-pointer appearance-none rounded-md border border-border-strong bg-surface py-2.5 pl-3 pr-9 text-sm text-fg',
          'transition-[border-color,box-shadow] duration-[120ms]',
          'focus:border-primary-500 focus:outline-none focus:ring-[3px] focus:ring-ring/25',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
}
