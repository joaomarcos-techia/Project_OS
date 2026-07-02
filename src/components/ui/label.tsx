import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Label de campo avulsa — DS v2 §fields (`.flabel`). */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn('text-(length:--fs-sm) font-medium text-fg', className)}
      {...props}
    />
  );
}
