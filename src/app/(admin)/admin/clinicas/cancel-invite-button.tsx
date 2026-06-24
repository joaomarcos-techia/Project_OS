'use client';

import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';

import { cancelClinicInviteAction, type InviteActionState } from '../actions/onboarding-invites';

const INITIAL: InviteActionState = { error: null };

export function CancelInviteButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelClinicInviteAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        title="Cancelar convite"
      >
        {pending ? '…' : 'Cancelar'}
      </button>
      {state.error ? <span className="text-xs text-danger-600">{state.error}</span> : null}
    </form>
  );
}
