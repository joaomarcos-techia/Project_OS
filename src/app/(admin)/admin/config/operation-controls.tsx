'use client';

/**
 * Controles de kill-switch da subtab "Operação" (C15 · Platform Settings). Client components que
 * postam para `setPlatformFlagAction` via useActionState (padrão impersonate-form).
 * A chave da flag chega por prop (server-only não pode cruzar p/ o client).
 * O valor é JSON-encoded num hidden input; o server valida por chave (zod).
 */
import { useActionState } from 'react';

import { setPlatformFlagAction, type PlatformFlagState } from '../actions/platform-settings';

const INITIAL: PlatformFlagState = { error: null };

/** Toggle genérico: clicar envia o valor OPOSTO ao estado atual (`on`). */
export function FlagToggle({
  flagKey,
  on,
  valueWhenOn,
  valueWhenOff,
  label,
}: {
  flagKey: string;
  on: boolean;
  valueWhenOn: unknown;
  valueWhenOff: unknown;
  label: string;
}) {
  const [state, action, pending] = useActionState(setPlatformFlagAction, INITIAL);
  const nextValue = on ? valueWhenOff : valueWhenOn;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="value" value={JSON.stringify(nextValue)} />
      <button
        type="submit"
        className={`toggle${on ? ' on' : ''}`}
        disabled={pending}
        aria-pressed={on}
        aria-label={label}
      />
      {state.error ? <span className="text-xs text-danger-600">{state.error}</span> : null}
    </form>
  );
}
