'use client';

/**
 * Controles da thread (ADR-047): assumir / devolver ao agente / responder.
 *
 * ÚNICO componente client da feature. Tudo que ele faz é UX — bloquear o que o
 * servidor já bloquearia de qualquer forma, e evitar que o operador escreva uma
 * mensagem que seria rejeitada só depois de enviada.
 *
 * A `idempotencyKey` é gerada uma vez por montagem do formulário e só troca
 * após um envio bem-sucedido: duplo-clique (ou retry do navegador) reusa a
 * mesma chave e o servidor devolve o resultado original em vez de duplicar.
 */
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import type { AIHandoffState } from '@/contexts/ai-agent/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useActionFeedback } from '@/components/ui/use-action-feedback';
import { uuidv4 } from '@/lib/ui/uuid';

import {
  assumirConversaAction,
  definirPrioridadeAction,
  devolverAoAgenteAction,
  responderAction,
  type ConversaActionState,
} from '../../actions';

type Props = {
  conversationId: string;
  status: 'active' | 'handoff' | 'closed' | 'abandoned';
  windowOpen: boolean;
  windowClosesAt: string | null;
  lastInboundAt: string | null;
  canManage: boolean;
  handoff: AIHandoffState | null;
  currentUserId: string;
  assignedToName: string | null;
};

const newKey = uuidv4;

export function ConversaActions({
  conversationId,
  status,
  windowOpen,
  windowClosesAt,
  lastInboundAt,
  canManage,
  handoff,
  currentUserId,
  assignedToName,
}: Props) {
  if (!canManage) return null;
  const terminal = status === 'closed' || status === 'abandoned';
  if (terminal) {
    return (
      <Alert variant="info" title="Conversa encerrada">
        Conversas encerradas ou abandonadas não recebem resposta. Se o paciente escrever de novo,
        uma conversa nova é aberta.
      </Alert>
    );
  }
  if (status === 'handoff' && handoff?.assignedToUserId === currentUserId) {
    return (
      <HandoffPanel
        conversationId={conversationId}
        windowOpen={windowOpen}
        windowClosesAt={windowClosesAt}
        lastInboundAt={lastInboundAt}
        handoff={handoff}
      />
    );
  }
  return (
    <AssumePanel
      conversationId={conversationId}
      handoff={status === 'handoff' ? handoff : null}
      assignedToName={assignedToName}
    />
  );
}

function AssumePanel({
  conversationId,
  handoff,
  assignedToName,
}: {
  conversationId: string;
  handoff: AIHandoffState | null;
  assignedToName: string | null;
}) {
  const [state, action, pending] = useActionState<ConversaActionState, FormData>(
    assumirConversaAction,
    null,
  );
  useActionFeedback(state, (s) =>
    s === null
      ? null
      : s.ok
        ? {
            type: 'success',
            title: 'Conversa assumida',
            description: 'O agente parou de responder.',
          }
        : { type: 'error', title: 'Não foi possível assumir', description: s.message },
  );

  const key = useIdempotencyKey(state?.ok === true);

  return (
    <form action={action} className="flex flex-col gap-(--sp-3)">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      {handoff ? (
        <Alert
          variant={handoff.overdue ? 'danger' : 'warning'}
          title={handoff.overdue ? 'SLA vencido' : 'Aguardando responsável'}
        >
          {assignedToName
            ? `Atendimento atribuído a ${assignedToName}. Assumir agora transfere formalmente a responsabilidade para você.`
            : 'Nenhum membro assumiu formalmente este atendimento.'}{' '}
          Prazo: {new Date(handoff.dueAt).toLocaleString('pt-BR')}.
        </Alert>
      ) : (
        <Alert variant="info" title="O agente está respondendo">
          Para responder pelo painel, assuma a conversa primeiro. Enquanto o agente estiver ativo,
          ele responderia junto e o paciente receberia duas respostas.
        </Alert>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending
          ? 'Assumindo…'
          : handoff?.assignedToUserId
            ? 'Reatribuir para mim'
            : 'Assumir atendimento'}
      </Button>
    </form>
  );
}

function HandoffPanel({
  conversationId,
  windowOpen,
  windowClosesAt,
  lastInboundAt,
  handoff,
}: {
  conversationId: string;
  windowOpen: boolean;
  windowClosesAt: string | null;
  lastInboundAt: string | null;
  handoff: AIHandoffState;
}) {
  const [replyState, replyAction, replying] = useActionState<ConversaActionState, FormData>(
    responderAction,
    null,
  );
  const [returnState, returnAction, returning] = useActionState<ConversaActionState, FormData>(
    devolverAoAgenteAction,
    null,
  );
  const [priorityState, priorityAction, prioritizing] = useActionState<
    ConversaActionState,
    FormData
  >(definirPrioridadeAction, null);
  const textId = useId();
  const [text, setText] = useState('');

  useActionFeedback(replyState, (s) =>
    s === null
      ? null
      : s.ok
        ? { type: 'success', title: 'Mensagem na fila de envio' }
        : { type: 'error', title: 'Não foi possível enviar', description: s.message },
  );
  useActionFeedback(returnState, (s) =>
    s === null
      ? null
      : s.ok
        ? { type: 'success', title: 'Conversa devolvida ao agente' }
        : { type: 'error', title: 'Não foi possível devolver', description: s.message },
  );
  useActionFeedback(priorityState, (s) =>
    s === null
      ? null
      : s.ok
        ? { type: 'success', title: 'Prioridade atualizada' }
        : { type: 'error', title: 'Não foi possível priorizar', description: s.message },
  );

  // Limpa o campo só quando o envio deu certo — em erro o texto continua ali
  // para o operador não reescrever.
  useEffect(() => {
    if (replyState?.ok) setText('');
  }, [replyState]);

  const replyKey = useIdempotencyKey(replyState?.ok === true);
  const returnKey = useIdempotencyKey(returnState?.ok === true);
  const priorityKey = useIdempotencyKey(priorityState?.ok === true);

  return (
    <div className="flex flex-col gap-(--sp-4)">
      <Alert
        variant={handoff.overdue ? 'danger' : handoff.priority === 'urgent' ? 'warning' : 'info'}
        title={handoff.overdue ? 'SLA vencido' : 'Atendimento sob sua responsabilidade'}
      >
        Prazo: {new Date(handoff.dueAt).toLocaleString('pt-BR')} · prioridade{' '}
        {handoff.priority === 'urgent' ? 'urgente' : 'normal'}.
      </Alert>

      <form action={priorityAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="idempotencyKey" value={priorityKey} />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Prioridade
          <select
            name="priority"
            defaultValue={handoff.priority}
            disabled={prioritizing}
            className="h-9 rounded-(--r-sm) border border-border bg-surface px-3 text-sm"
          >
            <option value="normal">Normal</option>
            <option value="urgent">Urgente</option>
          </select>
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={prioritizing}>
          Atualizar
        </Button>
      </form>
      {windowOpen ? null : (
        <Alert variant="warning" title="Janela de 24h da Meta expirada">
          {lastInboundAt
            ? `A última mensagem do paciente foi em ${new Date(lastInboundAt).toLocaleString('pt-BR')}. `
            : 'Este contato ainda não enviou nenhuma mensagem. '}
          O WhatsApp só aceita texto livre até 24h depois do último contato do paciente. Para
          retomar, é preciso que o paciente escreva de novo.
        </Alert>
      )}

      <form action={replyAction} className="flex flex-col gap-(--sp-2)">
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="idempotencyKey" value={replyKey} />
        <label htmlFor={textId} className="sr-only">
          Resposta ao paciente
        </label>
        <Textarea
          id={textId}
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!windowOpen || replying}
          maxLength={4000}
          placeholder={
            windowOpen
              ? 'Escreva a resposta ao paciente…'
              : 'Envio bloqueado: janela de 24h expirada'
          }
          aria-describedby={windowOpen && windowClosesAt ? `${textId}-hint` : undefined}
        />
        <div className="flex flex-wrap items-center justify-between gap-(--sp-2)">
          {windowOpen && windowClosesAt ? (
            <span id={`${textId}-hint`} className="text-(length:--fs-xs) text-fg-subtle">
              A janela fecha em {new Date(windowClosesAt).toLocaleString('pt-BR')}.
            </span>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={!windowOpen || replying || text.trim().length === 0}>
            {replying ? 'Enviando…' : 'Enviar resposta'}
          </Button>
        </div>
      </form>

      <form action={returnAction}>
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="idempotencyKey" value={returnKey} />
        <Button type="submit" variant="secondary" size="sm" disabled={returning}>
          {returning ? 'Devolvendo…' : 'Devolver ao agente'}
        </Button>
      </form>
    </div>
  );
}

/**
 * Chave de idempotência estável entre renders, renovada só na transição para
 * sucesso. É o que faz o duplo-clique ser inofensivo: os dois cliques mandam a
 * MESMA chave e o servidor devolve o resultado do primeiro. Gerar a chave a
 * cada render transformaria cada clique numa mensagem nova.
 */
function useIdempotencyKey(succeeded: boolean): string {
  const [key, setKey] = useState(newKey);
  const prev = useRef(succeeded);
  useEffect(() => {
    if (succeeded && !prev.current) setKey(newKey());
    prev.current = succeeded;
  }, [succeeded]);
  return key;
}
