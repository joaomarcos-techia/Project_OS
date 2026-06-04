'use client';

import { useActionState, useMemo } from 'react';

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
    <section className="mt-8 border-t border-gray-200 pt-4">
      <h2 className="mb-1 text-sm font-semibold uppercase text-gray-500">LGPD (pedido do titular)</h2>
      <p className="mb-2 text-xs text-gray-500">
        Direitos do paciente sobre os próprios dados (LGPD). A exclusão aqui registra um
        pedido formal de eliminação (Art. 18) — diferente da exclusão operacional acima.
      </p>
      <div className="flex flex-wrap gap-3">
        <form action={exportAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="idempotencyKey" value={exportKey} />
          <button
            type="submit"
            disabled={exporting}
            className="rounded border border-gray-400 px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {exporting ? 'Solicitando…' : 'Exportar dados (LGPD)'}
          </button>
        </form>

        <form action={deleteAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="idempotencyKey" value={deleteKey} />
          <button
            type="submit"
            disabled={deleting}
            className="rounded border border-red-400 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
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
            {deleting ? 'Solicitando…' : 'Solicitar exclusão (LGPD)'}
          </button>
        </form>
      </div>

      {exportState.message ? (
        <p className="mt-2 rounded border border-green-400 bg-green-50 p-2 text-sm text-green-900">
          {exportState.message}
        </p>
      ) : null}
      {(exportState.error || deleteState.error) ? (
        <p className="mt-2 text-sm text-red-700">{exportState.error ?? deleteState.error}</p>
      ) : null}
    </section>
  );
}
