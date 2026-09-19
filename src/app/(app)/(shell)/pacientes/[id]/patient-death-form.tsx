'use client';

import { useActionState, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uuidv4 } from '@/lib/ui/uuid';

import { recordPatientDeathForm, type PatientFormState } from '../actions';

const INITIAL: PatientFormState = { error: null };

export function PatientDeathForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(recordPatientDeathForm, INITIAL);
  const idempotencyKey = useMemo(() => uuidv4(), []);

  return (
    <section className="mt-8 border-t border-border pt-4">
      <h2 className="mb-1 text-sm font-semibold uppercase text-fg-subtle">Registrar falecimento</h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Esta ação bloqueia novas consultas, cobranças automáticas e mensagens, além de cancelar
        agendamentos futuros e entradas na lista de espera.
      </p>
      <ConfirmDialog
        trigger={
          <Button type="button" variant="danger" size="sm" className="min-h-(--hit-target)">
            Registrar falecimento
          </Button>
        }
        title="Registrar falecimento"
        description="Esta ação bloqueia novas consultas, cobranças automáticas e mensagens, além de cancelar agendamentos futuros e entradas na lista de espera."
        confirmLabel="Confirmar falecimento"
        cancelLabel="Voltar"
        tone="danger"
        action={action}
        loading={pending}
        formFields={
          <>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          </>
        }
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-(length:--fs-sm)">
            Data do falecimento
            <Input name="deceasedAt" type="date" required />
          </label>
          <label className="grid gap-1 text-(length:--fs-sm)">
            Motivo ou fonte da informação
            <Textarea name="reason" required minLength={3} maxLength={500} />
          </label>
          {state.error ? (
            <p role="alert" className="text-(length:--fs-sm) text-danger-600">
              {state.error}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </section>
  );
}
