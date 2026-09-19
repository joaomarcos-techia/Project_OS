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
import { Clock } from 'lucide-react';

import type { AIHandoffState } from '@/contexts/ai-agent/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
      {/* O SLA já é a PRIMEIRA coisa da conversa, em faixa vermelha no topo do
          painel. Repeti-lo aqui embaixo não avisa ninguém duas vezes: só empurra
          o campo de resposta para longe e ensina o operador a ignorar avisos.
          O que o rodapé precisa dizer é outra coisa — se ainda dá para escrever. */}
      {windowOpen ? (
        <JanelaAberta closesAt={windowClosesAt} />
      ) : (
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
        <label htmlFor={textId} className="text-(length:--fs-sm) font-semibold text-fg">
          Responder ao paciente
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
          {/* O prazo da janela já está em `JanelaAberta`, acima do campo. Aqui
              fica só a âncora acessível: quem navega por teclado ouve o prazo ao
              focar o campo, sem que a mesma frase apareça duas vezes na tela. */}
          {windowOpen && windowClosesAt ? (
            <span id={`${textId}-hint`} className="sr-only">
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

      <Separator />

      <form action={priorityAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="idempotencyKey" value={priorityKey} />
        <label className="flex flex-col gap-1 text-(length:--fs-sm) font-medium">
          Prioridade
          <select
            name="priority"
            defaultValue={handoff.priority}
            disabled={prioritizing}
            className="h-(--control-h) rounded-(--r-sm) border border-border bg-surface px-3 text-(length:--fs-sm)"
          >
            <option value="normal">Normal</option>
            <option value="urgent">Urgente</option>
          </select>
        </label>
        <Button type="submit" variant="secondary" size="sm" disabled={prioritizing}>
          Atualizar
        </Button>
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
/**
 * Quanto tempo ainda dá para responder em texto livre.
 *
 * A Meta conta 24 h a partir da última mensagem do PACIENTE. O operador não
 * precisa do horário absoluto para decidir — precisa saber se escreve agora ou
 * se já perdeu a janela —, então o tempo restante vem por extenso e o horário
 * fica como referência.
 */
/**
 * "Agora", só DEPOIS da hidratação, atualizado a cada minuto.
 *
 * Devolve `null` no servidor e no primeiro render do cliente. Isso conserta dois
 * problemas de uma vez:
 *
 * 1. **Mismatch de hidratação.** `Date.now()` durante o render faz o servidor
 *    escrever "15 min" e o cliente, segundos depois, "14 min". O React descarta
 *    a subárvore e reporta o erro — capturado no Sentry em 11/09 com exatamente
 *    `+14 / -15` dentro do `<span className="font-mono …">`.
 * 2. **O contador não contava.** Calculado uma vez no render, ficava congelado:
 *    um relógio de janela de 24 h que não anda é pior que não ter relógio, porque
 *    o operador decide se ainda dá tempo de escrever olhando para ele.
 *
 * O intervalo é de 1 min porque a granularidade exibida é o minuto — despertar
 * mais vezes gastaria render sem mudar um pixel.
 */
function useAgoraAposMontar(): number | null {
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => {
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return agora;
}

export function JanelaAberta({ closesAt }: { closesAt: string | null }) {
  const agora = useAgoraAposMontar();
  if (!closesAt) return null;
  const fecha = new Date(closesAt);

  // O horário ABSOLUTO vem do prop e é estável — pode sair no servidor. Só o
  // relativo depende de "agora", e é ele que espera a montagem.
  const horario = fecha.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const restamMin =
    agora === null ? null : Math.max(0, Math.round((fecha.getTime() - agora) / 60_000));
  const horas = restamMin === null ? 0 : Math.floor(restamMin / 60);
  const hoje = agora === null ? null : new Date(agora).toDateString() === fecha.toDateString();

  return (
    <p className="flex flex-wrap items-center gap-(--sp-2) text-(length:--fs-sm)">
      <Clock aria-hidden="true" className="size-3.5 text-success-700" />
      <span className="font-medium text-success-700">Janela de 24 h aberta</span>
      <span className="text-fg-subtle">
        fecha às {horario}
        {hoje === null ? '' : hoje ? ' de hoje' : ' de amanhã'}
        {restamMin === null ? '' : ' · restam'}
      </span>
      {restamMin === null ? null : (
        <span className="font-mono font-semibold tabular-nums text-fg-muted">
          {horas > 0 ? `${horas} h ` : ''}
          {restamMin % 60} min
        </span>
      )}
    </p>
  );
}

function useIdempotencyKey(succeeded: boolean): string {
  const [key, setKey] = useState(newKey);
  const prev = useRef(succeeded);
  useEffect(() => {
    if (succeeded && !prev.current) setKey(newKey());
    prev.current = succeeded;
  }, [succeeded]);
  return key;
}
