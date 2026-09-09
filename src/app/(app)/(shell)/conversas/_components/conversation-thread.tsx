import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import type {
  AIConversationStatus,
  AIConversationThread,
  AIThreadMessage,
} from '@/contexts/ai-agent/types';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/ui/cn';

import { ConversaActions } from '../[id]/_components/conversa-actions';
import { RetryMessageButton } from '../[id]/_components/retry-message-button';
import styles from '../conversations.module.css';

export const STATUS_TONE: Record<AIConversationStatus, 'amber' | 'green' | 'gray'> = {
  handoff: 'amber',
  active: 'green',
  closed: 'gray',
  abandoned: 'gray',
};
export const STATUS_LABEL: Record<AIConversationStatus, string> = {
  handoff: 'Aguardando humano',
  active: 'Agente respondendo',
  closed: 'Encerrada',
  abandoned: 'Abandonada',
};
const AUTHOR_LABEL: Record<AIThreadMessage['author'], string> = {
  patient: 'Paciente',
  agent: 'Agente IA',
  human: 'Você / equipe',
};
const DELIVERY_LABEL = {
  pending: 'Enviando…',
  sent: 'Enviada ao WhatsApp',
  delivered: 'Entregue',
  read: 'Lida',
  failed: 'Falha no envio',
} as const;

export function ConversationThread({
  thread,
  canManage,
  currentUserId,
  assignedToName,
  backHref = '/conversas',
}: {
  thread: AIConversationThread;
  canManage: boolean;
  currentUserId: string;
  assignedToName: string | null;
  backHref?: string;
}) {
  const title =
    thread.patientDisplayName ??
    thread.contactPhone ??
    thread.maskedPhone ??
    'Contato desconhecido';
  const failedDeliveries = thread.messages.filter(
    (message) => message.delivery === 'failed',
  ).length;
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
          <Alert variant="danger" title="SLA de resposta vencido">
            Prazo de resposta: {new Date(thread.handoff.dueAt).toLocaleString('pt-BR')}.
          </Alert>
        </div>
      ) : null}
      <header className={styles.threadHeader}>
        <Avatar name={thread.patientDisplayName ?? 'Contato'} />
        <div className={styles.threadIdentity}>
          <div className={styles.threadTitle}>
            <h2>{title}</h2>
            <Badge tone={STATUS_TONE[thread.status]} dot>
              {STATUS_LABEL[thread.status]}
            </Badge>
          </div>
          <div className={styles.threadMeta}>
            {thread.contactPhone ? (
              <span className={styles.phone}>{thread.contactPhone}</span>
            ) : null}
            <span>Iniciada em {new Date(thread.startedAt).toLocaleString('pt-BR')}</span>
            {thread.intentAtual ? <span>Intenção: {thread.intentAtual}</span> : null}
          </div>
        </div>
      </header>
      {thread.handoff ? (
        <div className={styles.assignee}>
          <span>Atendimento humano</span>
          <strong>{assignedToName ?? 'Sem responsável'}</strong>
          <span>Prioridade {thread.handoff.priority === 'urgent' ? 'urgente' : 'normal'}</span>
        </div>
      ) : null}
      {failedDeliveries > 0 ? (
        <div className={styles.deliveryAlert}>
          <Alert variant="danger" title="Falha de entrega no WhatsApp">
            {failedDeliveries} mensagem{failedDeliveries === 1 ? '' : 'ns'} não{' '}
            {failedDeliveries === 1 ? 'foi entregue' : 'foram entregues'}. Confira o número e a
            conexão antes de reenviar.
          </Alert>
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
                    {message.author === 'patient'
                      ? (thread.patientDisplayName ?? 'Paciente')
                      : AUTHOR_LABEL[message.author]}
                  </strong>
                  {message.author === 'agent' ? <Badge tone="ai">IA</Badge> : null}
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString('pt-BR')}
                  </time>
                </div>
                <div className={styles.bubble} data-author={message.author}>
                  {message.text}
                </div>
                {message.delivery ? (
                  <div
                    className={cn(styles.delivery, message.delivery === 'failed' && styles.failed)}
                  >
                    <span>{DELIVERY_LABEL[message.delivery]}</span>
                    {message.delivery === 'failed' && canRetry ? (
                      <RetryMessageButton conversationId={thread.id} messageId={message.id} />
                    ) : null}
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
