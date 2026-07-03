'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Tabs intra-página (conteúdo client na mesma rota) — Radix + DS v2 §tabs.
 * Para navegação entre SUBROTAS use nav-tabs.tsx (Link + usePathname).
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  boxed = false,
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { boxed?: boolean }) {
  return (
    <TabsPrimitive.List
      className={cn(
        boxed
          ? 'inline-flex gap-0.5 rounded-(--r-md) bg-surface-inset p-0.75'
          : 'relative flex gap-0.5 border-b border-border',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  boxed = false,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & { boxed?: boolean }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'text-(length:--fs-sm) font-medium text-fg-muted transition-colors duration-(--dur-fast) hover:text-fg',
        'focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
        boxed
          ? 'rounded-(--r-sm) px-3 py-1.5 data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-(--elev-raised)'
          : cn(
              'relative px-3.5 py-2.5 data-[state=active]:text-primary',
              'after:absolute after:right-2 after:-bottom-px after:left-2 after:h-0.5 after:bg-primary after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100',
            ),
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('focus-visible:outline-none', className)}
      {...props}
    />
  );
}
