'use client';

import { useActionState } from 'react';

import { regenerateDocumentPdfForm, type FormState } from './actions';

const INITIAL: FormState = { error: null };

export function RegeneratePdfButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(regenerateDocumentPdfForm, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {pending ? 'Gerando…' : label}
      </button>
      {state.error ? <p className="mt-1 text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
