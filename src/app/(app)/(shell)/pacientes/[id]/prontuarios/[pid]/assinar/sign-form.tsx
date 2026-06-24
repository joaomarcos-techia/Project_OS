'use client';

import { useActionState, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
          className="size-4 accent-primary-600"
        />
        Paciente precisa retornar
      </label>

      {needsReturn ? (
        <label className="flex items-center gap-2 text-sm">
          Retornar em (dias):
          <Input
            type="number"
            name="returnDays"
            min={1}
            max={3650}
            defaultValue={90}
            className="w-24"
          />
        </label>
      ) : null}

      <Alert variant="warning">
        Ao assinar, o prontuário torna-se <strong>imutável</strong>. Correções posteriores ficam
        registradas no histórico (com motivo).
      </Alert>

      <Button type="submit" className="self-start" loading={pending}>
        Assinar prontuário
      </Button>
      {state.error ? <p className="text-sm text-danger-600">{state.error}</p> : null}
    </form>
  );
}
