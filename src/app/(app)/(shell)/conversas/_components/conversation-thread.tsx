import Link from 'next/link';
import { ArrowLeft, CircleX, Timer } from 'lucide-react';

import type { AIConversationThread, AIThreadMessage } from '@/contexts/ai-agent/types';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/ui/cn';

import { identidadeDoContato } from '../contact-identity';
import { apresentacaoDoStatus, prazoRelativo, type StatusTone } from '../status-presentation';
import { ConversaActions } from '../[id]/_components/conversa-actions';
import { RetryMessageButton } from '../[id]/_components/retry-message-button';
import styles from '../conversations.module.css';

/** O estado usa a MESMA gramática da fila; aqui ele só ganha moldura de badge. */
const BADGE_TONE: Record<StatusTone, 'ai' | 'blue' | 'amber' | 'gray'> = {
  ai: 'ai',
  human: 'blue',
  attention: 'amber',
  muted: 'gray',
};

const AUTHOR_CHIP: Record<AIThreadMessage['author'], string> = {
  patient: 'Paciente',
  agent: 'IA',
  human: 'Equipe',
  business_app: 'Celular',
};
const DELIVERY_LABEL = {
  pending: 'Enviando…',
  sent: 'Enviada ao WhatsApp',
  delivered: 'Entregue',
  read: 'Lida',
} as const;

/** Só a hora: a data já está no cabeçalho da conversa e nas linhas da fila. */
function hora(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
}

export function ConversationThread({
  thread,
  timeZone,
  canManage,
  currentUserId,
  assignedToName,
  backHref = '/conversas',
}: {
  thread: AIConversationThread;
  timeZone: string;
  canManage: boolean;
  currentUserId: string;
  assignedToName: string | null;
  backHref?: string;
}) {
  const contato = identidadeDoContato(thread);
  const estado = apresentacaoDoStatus({
    status: thread.status,
    windowOpen: thread.window.open,
    assignedToName,
  });
  const canRetry =
    canManage &&
    thread.status === 'handoff' &&
    thread.handoff?.assignedToUserId === currentUserId &&
    thread.window.open;

  return (
    <section className={styles.thread} aria-label="Conversa selecionada">
      <Link href={backHref} className={styles.back}>
        <ArrowLeft aria-hidden="true" size={16} /> Voltar às conversas
      </Link>
      {thread.handoff?.overdue ? (
        <div className={styles.sla}>
          <Timer aria-hidden="true" size={16} />
          <span>
            {prazoRelativo(thread.handoff.dueAt, new Date(), { longo: true })}
            {thread.window.lastInboundAt
              ? ` · o paciente aguarda desde ${hora(thread.window.lastInboundAt, timeZone)}`
              : ''}
          </span>
        </div>
      ) : null}
      <header className={styles.threadHeader}>
        <Avatar name={thread.patientDisplayName ?? thread.contactName ?? 'Contato'} />
        <div className={styles.threadIdentity}>
          <div className={styles.threadTitle}>
            <h2>{contato.titulo}</h2>
            <Badge tone={BADGE_TONE[estado.tone]}>
              <estado.Icon aria-hidden="true" className="size-3" />
              {estado.label}
            </Badge>
          </div>
          <div className={styles.threadMeta}>
            {contato.telefone ? <span className={styles.phone}>{contato.telefone}</span> : null}
            <span>conversa iniciada às {hora(thread.startedAt, timeZone)}</span>
            {thread.window.lastInboundAt ? (
              <span>última mensagem recebida {hora(thread.window.lastInboundAt, timeZone)}</span>
            ) : null}
          </div>
        </div>
      </header>
      {thread.handoff ? (
        <div className={styles.assignee}>
          <span>Atendimento humano</span>
          <strong>{assignedToName ?? 'Sem responsável'}</strong>
          <span>Prioridade {thread.handoff.priority === 'urgent' ? 'urgente' : 'normal'}</span>
          <p>
            A IA está pausada nesta conversa enquanto a equipe atende. Responder pelo WhatsApp
            Business do celular também mantém a pausa. Para retomar o atendimento automático, use
            “Devolver ao agente”; a IA responderá às próximas mensagens do paciente.
          </p>
          {!thread.handoff.assignedToUserId ? (
            <p>Nenhuma pessoa assumiu este atendimento no painel.</p>
          ) : null}
          {thread.handoff.priority === 'urgent' ? (
            <p>Encaminhamento urgente: revise com a equipe responsável antes de devolver à IA.</p>
          ) : null}
        </div>
      ) : null}
      <section aria-label="Histórico da conversa" className={styles.history}>
        {thread.messages.length === 0 ? (
          <EmptyState
            variant="compact"
            title="Nenhuma mensagem nesta conversa"
            description="As mensagens aparecerão aqui quando o contato ou a equipe responder."
          />
        ) : (
          <ol className={styles.messages}>
            {thread.messages.map((message) => (
              <li
                key={message.id}
                className={cn(styles.message, message.direction === 'out' && styles.outbound)}
              >
                <div className={styles.messageMeta}>
                  <strong>
                    {/* O chip ao lado já diz "Paciente": aqui vai QUEM é — nome do
                        cadastro, nome do WhatsApp ou, sem nenhum, o telefone. */}
                    {message.author === 'patient'
                      ? contato.titulo
                      : message.author === 'agent'
                        ? 'Agente Qoro'
                        : message.author === 'business_app'
                          ? 'Recepção pelo celular'
                          : (assignedToName ?? 'Equipe')}
                  </strong>
                  <span className={styles.authorChip}>{AUTHOR_CHIP[message.author]}</span>
                  <time dateTime={message.createdAt}>{hora(message.createdAt, timeZone)}</time>
                </div>
                <div className={styles.bubble} data-author={message.author}>
                  {message.text}
                </div>
                {/* A falha é uma CAIXA sob o balão, não uma legenda: ela carrega
                    a ação de reenvio e precisa do peso de um aviso. O sucesso
                    continua legenda — não há o que fazer a respeito dele. */}
                {message.delivery === 'failed' ? (
                  <div className={styles.deliveryFailed}>
                    <CircleX aria-hidden="true" size={15} />
                    <span>Não entregue às {hora(message.createdAt, timeZone)}</span>
                    {canRetry ? (
                      <RetryMessageButton conversationId={thread.id} messageId={message.id} />
                    ) : null}
                  </div>
                ) : message.delivery ? (
                  <div className={styles.delivery}>
                    <span>{DELIVERY_LABEL[message.delivery]}</span>
                  </div>
                ) : null}
                {message.meta ? <AgentMeta meta={message.meta} /> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      {canManage ? (
        <aside aria-label="Atendimento humano" className={styles.actions}>
          <ConversaActions
            key={thread.id}
            conversationId={thread.id}
            status={thread.status}
            windowOpen={thread.window.open}
            windowClosesAt={thread.window.closesAt}
            lastInboundAt={thread.window.lastInboundAt}
            timeZone={timeZone}
            canManage={canManage}
            handoff={thread.handoff}
            currentUserId={currentUserId}
            assignedToName={assignedToName}
          />
        </aside>
      ) : null}
    </section>
  );
}

/** Metadados operacionais recolhidos; o prompt de engenharia nunca chega ao painel. */
function AgentMeta({ meta }: { meta: NonNullable<AIThreadMessage['meta']> }) {
  const parts: string[] = [];
  if (meta.intent) parts.push(`intent: ${meta.intent}`);
  if (meta.model) parts.push(meta.model);
  if (meta.latencyMs !== null) parts.push(`${meta.latencyMs} ms`);
  if (meta.costUsd !== null) parts.push(`US$ ${meta.costUsd.toFixed(4)}`);
  const tools = Array.isArray(meta.toolCalls) ? meta.toolCalls.length : 0;
  if (tools > 0) parts.push(`${tools} tool call${tools === 1 ? '' : 's'}`);
  if (parts.length === 0) return null;
  return (
    <details className={styles.diagnostics}>
      <summary>Diagnóstico do agente</summary>
      <p>{parts.join(' · ')}</p>
    </details>
  );
}
