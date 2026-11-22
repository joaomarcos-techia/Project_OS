'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Dialog — Radix Dialog estilizado pelo DS v2 (§modal/scrim).
 * API shadcn-like: Dialog/DialogTrigger/DialogContent/DialogHeader/
 * DialogTitle/DialogDescription/DialogBody/DialogFooter/DialogClose.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-450 bg-[oklch(0.2_0.02_265/0.42)] backdrop-blur-[2px] data-[state=open]:animate-overlay-in',
        className,
      )}
      {...props}
    />
  );
}

type FocusReturnOptions = {
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  onOpenAutoFocus?: ((event: Event) => void) | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
};

/**
 * Devolução do foco ao fechar (WCAG 2.4.3). O Radix, no modo modal, devolve o foco ao
 * `DialogTrigger`. Um diálogo aberto por estado, sem Trigger (botão comum, item de menu), deixava o
 * foco no `body` (sonda A-02 de 17/11/2026, Fornecedores). Aqui o foco volta a quem o tinha quando o
 * diálogo abriu; com Trigger, é o próprio Trigger. `returnFocusRef` vale quando quem abriu some
 * (o item de um menu que já fechou): o alvo passa a ser o botão do menu.
 */
export function useFocusReturn({
  returnFocusRef,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: FocusReturnOptions) {
  const anterior = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus(event: Event) {
      const ativo = document.activeElement;
      anterior.current = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: Event) {
      onCloseAutoFocus?.(event);
      const alvo = returnFocusRef?.current ?? anterior.current;
      anterior.current = null;
      // Quem chamou já decidiu, ou não há para onde voltar: fica o padrão do Radix.
      if (event.defaultPrevented || !alvo?.isConnected) return;
      event.preventDefault();
      alvo.focus();
    },
  };
}

export function DialogContent({
  className,
  children,
  showClose = true,
  returnFocusRef,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}) {
  const foco = useFocusReturn({ returnFocusRef, onOpenAutoFocus, onCloseAutoFocus });
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        onOpenAutoFocus={foco.onOpenAutoFocus}
        onCloseAutoFocus={foco.onCloseAutoFocus}
        className={cn(
          // transform (não translate utility): a animação modal-in anima `transform`,
          // e translate+transform COMPOEM — com utility o modal nascia deslocado e "descia"
          'fixed top-1/2 left-1/2 z-(--z-modal) w-[min(540px,calc(100vw-32px))] [transform:translate(-50%,-50%)]',
          'overflow-hidden rounded-(--r-xl) border border-border bg-surface shadow-(--elev-modal)',
          'focus:outline-none data-[state=open]:animate-modal-in',
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="absolute top-3 right-3 grid size-(--hit-target) place-items-center rounded-(--r-sm) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/** Ícone de contexto do cabeçalho (`.mh-ic`) — tone primary ou danger. */
export function DialogHeaderIcon({
  tone = 'primary',
  children,
}: {
  tone?: 'primary' | 'danger';
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9.5 shrink-0 place-items-center rounded-(--r-md) [&>svg]:size-5',
        tone === 'danger'
          ? 'bg-danger-50 text-danger-600 dark:bg-[color-mix(in_oklch,var(--danger-500)_20%,transparent)] dark:text-danger-200'
          : 'bg-(--primary-soft) text-primary dark:text-primary-300',
      )}
    >
      {children}
    </span>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-start gap-3.5 px-(--sp-6) pt-(--sp-5) pb-(--sp-4)', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-(length:--fs-h4) leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-1 text-(length:--fs-sm) leading-normal text-fg-muted', className)}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-(--sp-6) pb-(--sp-5)', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex justify-end gap-2.5 border-t border-border bg-surface-2 px-(--sp-6) py-(--sp-4)',
        className,
      )}
      {...props}
    />
  );
}
