'use client';

import { CircleAlert, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderIcon,
  DialogTitle,
  DialogTrigger,
} from './dialog';

/**
 * Diálogo de confirmação para ações críticas/destrutivas (assinar, excluir,
 * encerrar). O confirmar é um submit de form — a server action (com auditoria)
 * permanece intocada; `children` recebe hidden inputs quando necessário.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'primary',
  action,
  loading = false,
  open,
  onOpenChange,
  children,
}: {
  /** Elemento que abre o diálogo (vira DialogTrigger asChild). */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** Server action do form de confirmação. */
  action: (formData: FormData) => void | Promise<void>;
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Conteúdo extra do form (hidden inputs, resumo do que será confirmado). */
  children?: ReactNode;
}) {
  return (
    <Dialog
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent>
        <DialogHeader>
          <DialogHeaderIcon tone={tone}>
            {tone === 'danger' ? <CircleAlert /> : <ShieldCheck />}
          </DialogHeaderIcon>
          <div className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </div>
        </DialogHeader>
        <form action={action}>
          {children ? <DialogBody>{children}</DialogBody> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {cancelLabel}
              </Button>
            </DialogClose>
            <Button type="submit" variant={tone} loading={loading}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
