'use client';

import { useActionState } from 'react';
import { replayAbacatePayReviewAction } from '../../actions/abacatepay-review';

export function ReplayForm(props: {
  accountId: string;
  eventId: string;
  clinicId: string;
  snapshot: string;
  limited: boolean;
}) {
  const [state, action, pending] = useActionState(replayAbacatePayReviewAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="accountId" value={props.accountId} />
      <input type="hidden" name="eventId" value={props.eventId} />
      <input type="hidden" name="clinicId" value={props.clinicId} />
      <input type="hidden" name="snapshot" value={props.snapshot} />
      <label>
        Motivo
        <select name="reason" required className="block w-full rounded border p-2">
          <option value="provider_recovered">Provedor voltou a responder</option>
          <option value="binding_reconciled">Vínculo conferido</option>
          <option value="evidence_available">Evidência remota disponível</option>
        </select>
      </label>
      <label>
        Identificador interno do incidente
        <input
          name="evidenceReference"
          required
          minLength={8}
          maxLength={80}
          pattern="[A-Za-z0-9][A-Za-z0-9_\-]{7,79}"
          placeholder="INC-20261110-001"
          className="block w-full rounded border p-2"
        />
        <span className="text-sm text-fg-muted">
          Use somente o código do registro protegido. Não cole URL, comprovante ou dados pessoais.
        </span>
      </label>
      <label>
        Código atual do autenticador
        <input
          name="code"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          pattern="[0-9]{6}"
          maxLength={6}
          className="block w-full rounded border p-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending || props.limited}
        className="rounded border px-4 py-2 disabled:opacity-50"
      >
        {pending
          ? 'Conferindo…'
          : props.limited
            ? 'Limite de reprocessamento atingido'
            : 'Autorizar uma nova leitura'}
      </button>
      {state.error ? (
        <p role="alert">{state.error}</p>
      ) : state.message ? (
        <p role="status">{state.message}</p>
      ) : null}
    </form>
  );
}
