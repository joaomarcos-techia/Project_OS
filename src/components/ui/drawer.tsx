'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';
import { DialogOverlay } from './dialog';

/**
 * Drawer lateral — mesmo Radix Dialog do dialog.tsx, posicionado na borda
 * (DS v2 §drawer). Para criação/edição em contexto (escada de navegação:
 * CONVENTIONS §Governança de UI).
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const SIZES = {
  md: 'w-[min(460px,100vw)]',
  lg: 'w-[min(640px,100vw)]',
} as const;

export function DrawerContent({
  className,
  children,
  side = 'right',
  size = 'md',
  showClose = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right';
  size?: keyof typeof SIZES;
  showClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-(--z-modal) flex h-dvh flex-col bg-surface shadow-(--elev-modal) focus:outline-none',
          SIZES[size],
          side === 'right'
            ? 'right-0 border-l border-border data-[state=open]:animate-drawer-in-right'
            : 'left-0 border-r border-border data-[state=open]:animate-drawer-in-left',
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="absolute top-4.5 right-4 grid size-8 place-items-center rounded-(--r-sm) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border px-(--sp-6) py-(--sp-5)',
        className,
      )}
      {...props}
    />
  );
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-(length:--fs-h4) font-semibold', className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-(length:--fs-sm) text-fg-muted', className)}
      {...props}
    />
  );
}

export function DrawerBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex-1 overflow-y-auto p-(--sp-6)', className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex gap-2.5 border-t border-border bg-surface-2 px-(--sp-6) py-(--sp-4)',
        className,
      )}
      {...props}
    />
  );
}
