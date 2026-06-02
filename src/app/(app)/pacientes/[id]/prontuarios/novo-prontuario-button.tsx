'use client';

import { useActionState, useMemo } from 'react';

import { createProntuarioForm, type FormState } from './actions';

const INITIAL: FormState = { error: null };

export function NovoProntuarioButton({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(createProntuarioForm, INITIAL);
  const key = useMemo(() => crypto.randomUUID(), []);
  return (
    <form action={action}>
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-teal-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Criando…' : 'Novo prontuário'}
      </button>
      {state.error ? <p className="mt-1 text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
