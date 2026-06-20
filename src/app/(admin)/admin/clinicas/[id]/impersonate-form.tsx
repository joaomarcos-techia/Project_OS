'use client';

import { useFormStatus } from 'react-dom';

import { buttonVariants } from '@/components/ui/button';

import { startImpersonationAction } from '../../actions/impersonation';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonVariants({ variant: 'primary' })}
    >
      {pending ? 'Iniciando…' : 'Impersonar clínica'}
    </button>
  );
}

/** Dispara o impersonate (server action). Toda ação subsequente é auditada. */
export function ImpersonateForm({ clinicId }: { clinicId: string }) {
  return (
    <form action={startImpersonationAction}>
      <input type="hidden" name="clinicId" value={clinicId} />
      <SubmitButton />
    </form>
  );
}
