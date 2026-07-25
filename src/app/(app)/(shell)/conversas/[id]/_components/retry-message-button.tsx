'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useActionFeedback } from '@/components/ui/use-action-feedback';
import { uuidv4 } from '@/lib/ui/uuid';

import { reenviarMensagemAction, type ConversaActionState } from '../../actions';

export function RetryMessageButton({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) {
  const [state, action, pending] = useActionState<ConversaActionState, FormData>(
    reenviarMensagemAction,
    null,
  );
  const [idempotencyKey] = useState(uuidv4);

  useActionFeedback(state, (result) =>
    result === null
      ? null
      : result.ok
        ? { type: 'success', title: 'Nova tentativa adicionada à fila' }
        : { type: 'error', title: 'Não foi possível reenviar', description: result.message },
  );

  return (
    <form action={action}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="messageId" value={messageId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Reenviando…' : 'Reenviar'}
      </Button>
    </form>
  );
}
