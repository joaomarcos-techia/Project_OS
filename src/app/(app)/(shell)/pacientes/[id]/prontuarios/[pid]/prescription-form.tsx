'use client';

import { useActionState, useMemo, useState } from 'react';

import { createPrescriptionForm, type FormState } from '../actions';

const INITIAL: FormState = { error: null };

interface Med {
  nome: string;
  dosagem?: string;
  posologia?: string;
  quantidade?: string;
  via?: string;
}

export function PrescriptionForm({
  patientId,
  prontuarioId,
}: {
  patientId: string;
  prontuarioId: string;
}) {
  const [state, action, pending] = useActionState(createPrescriptionForm, INITIAL);
  const key = useMemo(() => crypto.randomUUID(), []);
  const [meds, setMeds] = useState<Med[]>([{ nome: '' }]);

  const cleaned = meds
    .map((m) => ({
      nome: m.nome.trim(),
      dosagem: m.dosagem?.trim() || undefined,
      posologia: m.posologia?.trim() || undefined,
      quantidade: m.quantidade?.trim() || undefined,
      via: m.via?.trim() || undefined,
    }))
    .filter((m) => m.nome !== '');

  function update(i: number, patch: Partial<Med>) {
    setMeds((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="prontuarioId" value={prontuarioId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="medicamentos" value={JSON.stringify(cleaned)} />

      {meds.map((m, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 border-b border-gray-100 pb-2">
          <input
            value={m.nome}
            onChange={(e) => update(i, { nome: e.target.value })}
            placeholder="Medicamento *"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={m.dosagem ?? ''}
            onChange={(e) => update(i, { dosagem: e.target.value })}
            placeholder="Dosagem (ex.: 500mg)"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={m.posologia ?? ''}
            onChange={(e) => update(i, { posologia: e.target.value })}
            placeholder="Posologia (ex.: 1 cp 8/8h por 7 dias)"
            className="col-span-2 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={m.via ?? ''}
            onChange={(e) => update(i, { via: e.target.value })}
            placeholder="Via (ex.: oral)"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            value={m.quantidade ?? ''}
            onChange={(e) => update(i, { quantidade: e.target.value })}
            placeholder="Quantidade"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          {meds.length > 1 ? (
            <button
              type="button"
              onClick={() => setMeds((ms) => ms.filter((_, idx) => idx !== i))}
              className="col-span-2 text-left text-xs text-red-600 underline"
            >
              remover
            </button>
          ) : null}
        </div>
      ))}

      <button
        type="button"
        onClick={() => setMeds((ms) => [...ms, { nome: '' }])}
        className="self-start text-sm text-teal-700 underline"
      >
        + medicamento
      </button>

      <textarea
        name="observacoes"
        placeholder="Observações (opcional)"
        rows={2}
        className="rounded border border-gray-300 p-2 text-sm"
      />

      <button
        type="submit"
        disabled={pending || cleaned.length === 0}
        className="self-start rounded bg-teal-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Gerando…' : 'Emitir prescrição (PDF)'}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
