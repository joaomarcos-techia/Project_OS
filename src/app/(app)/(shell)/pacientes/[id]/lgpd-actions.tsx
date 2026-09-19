'use client';

import { useActionState, useMemo } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { uuidv4 } from '@/lib/ui/uuid';

import { requestLgpdDeleteForm, requestLgpdExportForm, type LgpdFormState } from '../actions';

const INITIAL: LgpdFormState = { error: null, message: null };

export function LgpdActions({
  id,
  canExport,
  canDelete,
}: {
  id: string;
  canExport: boolean;
  canDelete: boolean;
}) {
  const [exportState, exportAction, exporting] = useActionState(requestLgpdExportForm, INITIAL);
  const [deleteState, deleteAction, deleting] = useActionState(requestLgpdDeleteForm, INITIAL);
  const exportKey = useMemo(() => uuidv4(), []);
  const deleteKey = useMemo(() => uuidv4(), []);

  if (!canExport && !canDelete) return null;

  return (
    <section className="mt-8 border-t border-border pt-4">
      <h2 className="mb-1 text-sm font-semibold uppercase text-fg-subtle">
        LGPD (pedido do titular)
      </h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Direitos do paciente sobre os próprios dados (LGPD). A exclusão aqui registra um pedido
        formal de eliminação (Art. 18) — diferente da exclusão operacional acima.
      </p>
      <div className="flex flex-wrap gap-3">
        {canExport ? (
          <form action={exportAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="idempotencyKey" value={exportKey} />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="min-h-(--hit-target)"
              loading={exporting}
            >
              Exportar dados (LGPD)
            </Button>
          </form>
        ) : null}

        {canDelete ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="danger" size="sm" className="min-h-(--hit-target)">
                Solicitar exclusão (LGPD)
              </Button>
            }
            title="Registrar solicitação de exclusão LGPD"
            description="O pedido formal do titular é registrado para compliance, o cadastro recebe soft delete agora e a remoção definitiva ocorre em 30 dias."
            confirmLabel="Registrar solicitação"
            cancelLabel="Voltar"
            tone="danger"
            action={deleteAction}
            loading={deleting}
            formFields={
              <>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="idempotencyKey" value={deleteKey} />
              </>
            }
          >
            {deleteState.error ? (
              <p role="alert" className="text-(length:--fs-sm) text-danger-600">
                {deleteState.error}
              </p>
            ) : null}
          </ConfirmDialog>
        ) : null}
      </div>

      {canExport && exportState.message ? (
        <Alert variant="success" className="mt-3">
          {exportState.message}
        </Alert>
      ) : null}
      {canExport && exportState.error ? (
        <p className="mt-2 text-sm text-danger-600">{exportState.error}</p>
      ) : null}
    </section>
  );
}
