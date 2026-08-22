'use client';

import type { ReactNode } from 'react';
import { useRef, useState } from 'react';

import { ConfirmDialog } from './confirm-dialog';

/**
 * Confirmação destrutiva para mutações client-side. Mantém o diálogo aberto em
 * erro e impede reenvio enquanto a primeira tentativa está em andamento.
 */
export function DestructiveAction({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  action,
  disabled = false,
  onError,
}: {
  trigger: ReactNode;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  action: () => void | Promise<void>;
  disabled?: boolean;
  onError?: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function run() {
    if (pendingRef.current || disabled) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir a ação.');
      onError?.(caught);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending && !nextOpen) return;
        setOpen(nextOpen);
        if (nextOpen) setError(null);
      }}
      trigger={trigger}
      tone="danger"
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      loading={pending}
      onConfirm={run}
    >
      {error ? (
        <p role="alert" className="text-(length:--fs-sm) text-danger-600">
          {error}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
