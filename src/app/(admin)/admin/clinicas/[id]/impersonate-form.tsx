'use client';

import { useActionState, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';

import { startImpersonationAction, type ImpersonateState } from '../../actions/impersonation';

const INITIAL: ImpersonateState = { error: null };

/**
 * Impersonate em 2 passos, sem sair da tela: clicar revela o campo do TOTP; ao
 * confirmar, a action verifica o código (MFA a cada impersonate) e entra na
 * clínica. Sem bounce para /login/mfa nem /admin.
 */
export function ImpersonateForm({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(startImpersonationAction, INITIAL);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ variant: 'primary' })}
      >
        Impersonar clínica
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="clinicId" value={clinicId} />
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="Código do autenticador"
        aria-label="Código do autenticador (TOTP)"
        autoFocus
        className="input w-44"
      />
      <button type="submit" disabled={pending} className={buttonVariants({ variant: 'primary' })}>
        {pending ? 'Verificando…' : 'Confirmar e entrar'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        Cancelar
      </button>
      {state.error ? <span className="w-full text-sm text-danger-600">{state.error}</span> : null}
    </form>
  );
}
