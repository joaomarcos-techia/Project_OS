'use client';

import { useActionState, useMemo } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import {
  requestLgpdDeleteForm,
  requestLgpdExportForm,
  type LgpdFormState,
} from '../actions';

const INITIAL: LgpdFormState = { error: null, message: null };

export function LgpdActions({ id }: { id: string }) {
  const [exportState, exportAction, exporting] = useActionState(requestLgpdExportForm, INITIAL);
  const [deleteState, deleteAction, deleting] = useActionState(requestLgpdDeleteForm, INITIAL);
  const exportKey = useMemo(() => crypto.randomUUID(), []);
  const deleteKey = useMemo(() => crypto.randomUUID(), []);

  return (
    <section className="mt-8 border-t border-border pt-4">
      <h2 className="mb-1 text-sm font-semibold uppercase text-fg-subtle">LGPD (pedido do titular)</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Direitos do paciente sobre os próprios dados (LGPD). A exclusão aqui registra um
        pedido formal de eliminação (Art. 18) — diferente da exclusão operacional acima.
      </p>
      <div className="flex flex-wrap gap-3">
        <form action={exportAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="idempotencyKey" value={exportKey} />
          <Button type="submit" variant="secondary" size="sm" loading={exporting}>
            Exportar dados (LGPD)
          </Button>
        </form>

        <form action={deleteAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="idempotencyKey" value={deleteKey} />
          <Button
            type="submit"
            variant="danger"
            size="sm"
            loading={deleting}
            onClick={(e) => {
              if (
                !confirm(
                  'Registrar pedido de exclusão LGPD do titular? Soft delete agora + registro de compliance; remoção definitiva em 30 dias.',
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            Solicitar exclusão (LGPD)
          </Button>
        </form>
      </div>

      {exportState.message ? (
        <Alert variant="success" className="mt-3">
          {exportState.message}
        </Alert>
      ) : null}
      {(exportState.error || deleteState.error) ? (
        <p className="mt-2 text-sm text-danger-600">{exportState.error ?? deleteState.error}</p>
      ) : null}
    </section>
  );
}
