'use client';

import { useActionState, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uuidv4 } from '@/lib/ui/uuid';

import { recordPatientDeathForm, type PatientFormState } from '../actions';

const INITIAL: PatientFormState = { error: null };

export function PatientDeathForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(recordPatientDeathForm, INITIAL);
  const idempotencyKey = useMemo(() => uuidv4(), []);

  return (
    <form action={action} className="mt-8 border-t border-border pt-4">
      <h2 className="mb-1 text-sm font-semibold uppercase text-fg-subtle">
        Registrar falecimento
      </h2>
      <p className="mb-3 text-xs text-fg-subtle">
        Esta acao bloqueia novas consultas, cobrancas automaticas e mensagens, alem de cancelar
        agendamentos futuros e entradas na lista de espera.
      </p>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Data do falecimento
          <Input name="deceasedAt" type="date" required />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Motivo ou fonte da informacao
          <Textarea name="reason" required minLength={3} maxLength={500} />
        </label>
      </div>
      <Button
        type="submit"
        variant="danger"
        size="sm"
        className="mt-3"
        loading={pending}
        onClick={(event) => {
          if (!confirm('Confirmar o registro de falecimento? Esta acao bloqueia operacoes futuras.')) {
            event.preventDefault();
          }
        }}
      >
        Registrar falecimento
      </Button>
      {state.error ? <p className="mt-2 text-sm text-danger-600">{state.error}</p> : null}
    </form>
  );
}
