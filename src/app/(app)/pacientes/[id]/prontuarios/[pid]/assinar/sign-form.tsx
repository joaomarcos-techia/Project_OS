'use client';

import { useActionState, useMemo, useState } from 'react';

import { signProntuarioForm, type FormState } from '../../actions';

const INITIAL: FormState = { error: null };

export function SignProntuarioForm({
  patientId,
  prontuarioId,
}: {
  patientId: string;
  prontuarioId: string;
}) {
  const [state, action, pending] = useActionState(signProntuarioForm, INITIAL);
  const key = useMemo(() => crypto.randomUUID(), []);
  const [needsReturn, setNeedsReturn] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="prontuarioId" value={prontuarioId} />
      <input type="hidden" name="idempotencyKey" value={key} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="needsReturn"
          checked={needsReturn}
          onChange={(e) => setNeedsReturn(e.target.checked)}
        />
        Paciente precisa retornar
      </label>

      {needsReturn ? (
        <label className="text-sm">
          Retornar em (dias):{' '}
          <input
            type="number"
            name="returnDays"
            min={1}
            max={3650}
            defaultValue={90}
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      ) : null}

      <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
        Ao assinar, o prontuário torna-se <strong>imutável</strong>. Correções posteriores ficam
        registradas no histórico (com motivo).
      </p>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-teal-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Assinando…' : 'Assinar prontuário'}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
