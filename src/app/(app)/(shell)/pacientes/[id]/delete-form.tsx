'use client';

import { useActionState, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import { deletePatientForm, type PatientFormState } from '../actions';
import { uuidv4 } from '@/lib/ui/uuid';

const INITIAL: PatientFormState = { error: null };

export function DeletePatientForm({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(deletePatientForm, INITIAL);
  const idempotencyKey = useMemo(() => uuidv4(), []);
  return (
    <section className="mt-2">
      <h2 className="mb-1 text-sm font-semibold uppercase text-fg-subtle">Excluir (operacional)</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Uso interno da clínica (cadastro errado, duplicado). Soft delete agora; remoção definitiva
        em 30 dias. Para pedido do próprio paciente, use a exclusão LGPD abaixo.
      </p>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="danger" size="sm" className="min-h-(--hit-target)">
            Excluir paciente
          </Button>
        }
        title="Excluir paciente"
        description="O cadastro fica indisponível agora e é removido definitivamente em 30 dias. Use a exclusão LGPD quando o pedido vier do titular."
        confirmLabel="Excluir paciente"
        cancelLabel="Manter paciente"
        tone="danger"
        action={formAction}
        loading={pending}
        formFields={
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          </>
        }
      >
        {state.error ? (
          <p role="alert" className="text-(length:--fs-sm) text-danger-600">
            {state.error}
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
