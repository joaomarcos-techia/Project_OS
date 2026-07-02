'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/** Dropdown menu — Radix estilizado pelo DS v2 (§menu). */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-(--z-dropdown) min-w-55 animate-menu-in rounded-(--r-lg) border border-border-2 bg-surface p-1.5 shadow-(--elev-popover)',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger = false,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-(--r-sm) px-2.5 py-2 text-(length:--fs-sm) outline-none transition-colors',
        'data-highlighted:bg-surface-hover',
        '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-subtle data-highlighted:[&>svg]:text-fg-muted',
        danger &&
          'text-danger-600 data-highlighted:bg-danger-50 dark:data-highlighted:bg-[color-mix(in_oklch,var(--danger-500)_18%,transparent)] [&>svg]:text-danger-500',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-2.5 pt-1.75 pb-1.25 font-mono text-[10px] tracking-(--tracking-label) text-fg-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('mx-1 my-1.5 h-px bg-border', className)}
      {...props}
    />
  );
}

/** Atalho/nota à direita do item (`.mi-r`). */
export function DropdownMenuShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('ml-auto font-mono text-[10px] text-fg-subtle', className)}
      {...props}
    />
  );
}
