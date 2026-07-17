'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Popover — Radix estilizado pelo DS v2 (§popover). */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  sideOffset = 6,
  align = 'start',
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-(--z-dropdown) w-75 animate-menu-in rounded-(--r-lg) border border-border-2 bg-surface p-(--sp-4) shadow-(--elev-popover) focus:outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export function PopoverHeading({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('mb-2 text-(length:--fs-sm) font-semibold', className)} {...props} />
  );
}
