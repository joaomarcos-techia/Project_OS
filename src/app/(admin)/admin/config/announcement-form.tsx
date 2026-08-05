'use client';

/**
 * Broadcast (C15 · Platform Settings) — compor aviso global + desativar, via useActionState
 * (publishAnnouncementAction / deactivateAnnouncementAction). Texto puro.
 */
import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';

import {
  deactivateAnnouncementAction,
  publishAnnouncementAction,
  type AnnouncementState,
} from '../actions/platform-settings';

const INITIAL: AnnouncementState = { error: null };

export function AnnouncementForm() {
  const [state, action, pending] = useActionState(publishAnnouncementAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input
        name="title"
        maxLength={120}
        placeholder="Título (opcional, até 120 caracteres)"
        className="input"
      />
      <textarea
        name="message"
        maxLength={280}
        required
        rows={2}
        placeholder="Mensagem do aviso (texto puro, até 280 caracteres)"
        className="input"
      />
      <div className="flex flex-wrap items-center gap-3">
        <select name="level" defaultValue="info" className="select" style={{ maxWidth: 160 }}>
          <option value="info">Informativo</option>
          <option value="warning">Atenção</option>
        </select>
        <label className="text-xs text-fg-muted">
          Expira em (opcional)
          <input
            type="datetime-local"
            name="endsAt"
            className="input"
            style={{ maxWidth: 220, marginTop: 2 }}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={buttonVariants({ variant: 'primary', size: 'sm' })}
        >
          {pending ? 'Publicando…' : 'Publicar aviso'}
        </button>
      </div>
      {state.error ? <span className="text-sm text-danger-600">{state.error}</span> : null}
    </form>
  );
}

export function DeactivateAnnouncementButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deactivateAnnouncementAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        {pending ? '…' : 'Desativar'}
      </button>
      {state.error ? <span className="text-xs text-danger-600">{state.error}</span> : null}
    </form>
  );
}
