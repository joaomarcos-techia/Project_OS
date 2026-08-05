'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { manageFeedbackAction, type ManageFeedbackState } from '../actions/feedback';

const INITIAL: ManageFeedbackState = { error: null };

const STATUSES = [
  ['received', 'Recebido'],
  ['under_review', 'Em análise'],
  ['planned', 'Planejado'],
  ['in_development', 'Em desenvolvimento'],
  ['completed', 'Concluído'],
  ['rejected', 'Recusado'],
] as const;

export function FeedbackManager({ feedbackId, status }: { feedbackId: string; status: string }) {
  const [state, action, pending] = useActionState(manageFeedbackAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Select
          name="status"
          defaultValue={status}
          aria-label="Status do feedback"
          disabled={pending}
        >
          {STATUSES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Button name="operation" value="update" type="submit" loading={pending}>
          Salvar status
        </Button>
      </div>
      <Textarea
        name="note"
        maxLength={4000}
        disabled={pending}
        placeholder="Nota interna para o histórico (opcional)"
        aria-label="Nota interna"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          name="operation"
          value="archive"
          type="submit"
          variant="secondary"
          size="sm"
          disabled={pending}
        >
          Arquivar
        </Button>
        <Button
          name="operation"
          value="delete"
          type="submit"
          variant="danger"
          size="sm"
          disabled={pending}
        >
          Excluir
        </Button>
      </div>
      {state.error ? <p className="text-(length:--fs-xs) text-danger-600">{state.error}</p> : null}
      {state.success ? (
        <p className="text-(length:--fs-xs) text-success-700">Alteração registrada.</p>
      ) : null}
    </form>
  );
}
