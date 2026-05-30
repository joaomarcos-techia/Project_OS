'use client';

import { useActionState, useMemo } from 'react';

import { deletePatientForm, type PatientFormState } from '../actions';

const INITIAL: PatientFormState = { error: null };

export function DeletePatientForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(deletePatientForm, INITIAL);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  return (
    <form action={formAction} className="mt-2">
      <h2 className="mb-1 text-sm font-semibold uppercase text-gray-500">Excluir (operacional)</h2>
      <p className="mb-2 text-xs text-gray-500">
        Uso interno da clínica (cadastro errado, duplicado). Soft delete agora; remoção
        definitiva em 30 dias. Para pedido do próprio paciente, use a exclusão LGPD abaixo.
      </p>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-red-400 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
        onClick={(e) => {
          if (!confirm('Excluir paciente (operacional)? Soft delete; remoção definitiva em 30 dias.')) {
            e.preventDefault();
          }
        }}
      >
        {pending ? 'Excluindo…' : 'Excluir paciente'}
      </button>
      {state.error ? <p className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}
