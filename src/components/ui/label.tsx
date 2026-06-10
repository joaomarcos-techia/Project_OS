import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Label de campo — DS §08.9. */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-[12.5px] font-medium text-fg-muted', className)} {...props} />;
}
