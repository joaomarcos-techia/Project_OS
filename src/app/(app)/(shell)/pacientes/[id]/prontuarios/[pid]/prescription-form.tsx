'use client';

import { useActionState, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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
  const [kind, setKind] = useState<'simples' | 'controle_especial'>('simples');

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
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="prontuarioId" value={prontuarioId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="medicamentos" value={JSON.stringify(cleaned)} />
      <input type="hidden" name="kind" value={kind} />

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Tipo de receita</span>
        <div className="inline-flex w-fit overflow-hidden rounded-md border border-border">
          <button
            type="button"
            onClick={() => setKind('simples')}
            aria-pressed={kind === 'simples'}
            className={`px-3 py-1.5 text-sm ${
              kind === 'simples' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg'
            }`}
          >
            Receita simples
          </button>
          <button
            type="button"
            onClick={() => setKind('controle_especial')}
            aria-pressed={kind === 'controle_especial'}
            className={`px-3 py-1.5 text-sm ${
              kind === 'controle_especial' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg'
            }`}
          >
            Controle especial
          </button>
        </div>
      </div>

      {kind === 'controle_especial' ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Para benzodiazepínicos e estimulantes (tarja preta) use seu talão oficial. Este
          receituário cobre o controle especial branco de 2 vias (antibióticos, tramadol, codeína e
          a maioria dos psiquiátricos C1). Válido somente com assinatura e carimbo físicos.
        </p>
      ) : null}

      {meds.map((m, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 border-b border-border pb-3">
          <Input
            value={m.nome}
            onChange={(e) => update(i, { nome: e.target.value })}
            placeholder="Medicamento *"
          />
          <Input
            value={m.dosagem ?? ''}
            onChange={(e) => update(i, { dosagem: e.target.value })}
            placeholder="Dosagem (ex.: 500mg)"
          />
          <Input
            value={m.posologia ?? ''}
            onChange={(e) => update(i, { posologia: e.target.value })}
            placeholder="Posologia (ex.: 1 cp 8/8h por 7 dias)"
            className="col-span-2"
          />
          <Input
            value={m.via ?? ''}
            onChange={(e) => update(i, { via: e.target.value })}
            placeholder="Via (ex.: oral)"
          />
          <Input
            value={m.quantidade ?? ''}
            onChange={(e) => update(i, { quantidade: e.target.value })}
            placeholder="Quantidade"
          />
          {meds.length > 1 ? (
            <button
              type="button"
              onClick={() => setMeds((ms) => ms.filter((_, idx) => idx !== i))}
              className="col-span-2 text-left text-xs text-danger-600 underline"
            >
              remover
            </button>
          ) : null}
        </div>
      ))}

      <button
        type="button"
        onClick={() => setMeds((ms) => [...ms, { nome: '' }])}
        className="self-start text-sm font-medium text-primary-600 underline"
      >
        + medicamento
      </button>

      <Textarea name="observacoes" placeholder="Observações (opcional)" rows={2} />

      <Button
        type="submit"
        className="self-start"
        loading={pending}
        disabled={cleaned.length === 0}
      >
        Emitir prescrição (PDF)
      </Button>
      {state.error ? <p className="text-sm text-danger-600">{state.error}</p> : null}
    </form>
  );
}
