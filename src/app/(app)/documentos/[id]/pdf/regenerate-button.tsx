'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { regenerateDocumentPdfForm, type FormState } from './actions';

const INITIAL: FormState = { error: null };

export function RegeneratePdfButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(regenerateDocumentPdfForm, INITIAL);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="secondary" loading={pending}>
        {label}
      </Button>
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
    </form>
  );
}
