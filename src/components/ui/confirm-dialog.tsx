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

type ConfirmBehavior =
  | {
      /** Server/React form action da confirmação. */
      action: (formData: FormData) => void | Promise<void>;
      onConfirm?: never;
    }
  | {
      /** Mutação client-side disparada sem converter o clique em form action. */
      action?: never;
      onConfirm: () => void | Promise<void>;
    };

type ConfirmDialogProps = {
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Campos sem UI (por exemplo, ids e chaves idempotentes) enviados pelo form. */
  formFields?: ReactNode;
  /** Conteúdo visível do form (resumo, campos ou erro da confirmação). */
  children?: ReactNode;
} & ConfirmBehavior;

/**
 * Diálogo de confirmação para ações críticas/destrutivas (assinar, excluir,
 * encerrar). O confirmar é um submit de form — a server action (com auditoria)
 * permanece intocada; `formFields` recebe campos sem UI e `children`, conteúdo
 * visível que contextualiza a decisão ou mostra erro.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'primary',
  action,
  onConfirm,
  loading = false,
  open,
  onOpenChange,
  formFields,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        showClose={!loading}
        onEscapeKeyDown={(event) => {
          if (loading) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (loading) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogHeaderIcon tone={tone}>
            {tone === 'danger' ? <CircleAlert /> : <ShieldCheck />}
          </DialogHeaderIcon>
          <div className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </div>
        </DialogHeader>
        <form {...(action ? { action } : {})}>
          {formFields}
          {children ? <DialogBody>{children}</DialogBody> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={loading}>
                {cancelLabel}
              </Button>
            </DialogClose>
            <Button
              type={onConfirm ? 'button' : 'submit'}
              variant={tone}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
