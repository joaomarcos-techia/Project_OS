'use client';

import { useActionState, useMemo } from 'react';

import { Button } from '@/components/ui/button';

import { createProntuarioForm, type FormState } from './actions';
import { uuidv4 } from '@/lib/ui/uuid';

const INITIAL: FormState = { error: null };

export function NovoProntuarioButton({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(createProntuarioForm, INITIAL);
  const key = useMemo(() => uuidv4(), []);
  return (
    <form action={action}>
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <Button type="submit" size="sm" className="min-h-(--hit-target)" loading={pending}>
        Novo prontuário
      </Button>
      {state.error ? <p className="mt-1 text-sm text-danger-600">{state.error}</p> : null}
    </form>
  );
}
