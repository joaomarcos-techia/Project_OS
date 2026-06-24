import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Select nativo estilizado — classe do Design System (`ds.css` `.select`). O
 * chevron é desenhado pela própria `.select` (background-image), então não há
 * overlay React. API inalterada (todos os props nativos passam adiante).
 */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn('select', className)} {...props} />;
}
