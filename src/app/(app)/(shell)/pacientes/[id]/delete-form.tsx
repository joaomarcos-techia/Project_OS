'use client';

import { useActionState, useMemo } from 'react';

import { Button } from '@/components/ui/button';

import { deletePatientForm, type PatientFormState } from '../actions';
import { uuidv4 } from '@/lib/ui/uuid';

const INITIAL: PatientFormState = { error: null };

export function DeletePatientForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(deletePatientForm, INITIAL);
  const idempotencyKey = useMemo(() => uuidv4(), []);
  return (
    <form action={formAction} className="mt-2">
      <h2 className="mb-1 text-sm font-semibold uppercase text-fg-subtle">Excluir (operacional)</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Uso interno da clínica (cadastro errado, duplicado). Soft delete agora; remoção
        definitiva em 30 dias. Para pedido do próprio paciente, use a exclusão LGPD abaixo.
      </p>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Button
        type="submit"
        variant="danger"
        size="sm"
        loading={pending}
        onClick={(e) => {
          if (!confirm('Excluir paciente (operacional)? Soft delete; remoção definitiva em 30 dias.')) {
            e.preventDefault();
          }
        }}
      >
        Excluir paciente
      </Button>
      {state.error ? <p className="mt-2 text-sm text-danger-600">{state.error}</p> : null}
    </form>
  );
}
