'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Tooltip — Radix estilizado pelo DS v2 (§tip). O <TooltipProvider> é montado
 * uma vez por shell (layout do painel/admin).
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-(--z-tooltip) animate-menu-in rounded-(--r-sm) bg-secondary px-2.5 py-1.5 text-[11px] whitespace-nowrap text-secondary-fg shadow-md',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
