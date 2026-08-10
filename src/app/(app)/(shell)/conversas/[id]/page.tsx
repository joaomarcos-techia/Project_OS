/**
 * /conversas/[id] — thread de uma conversa (ADR-047).
 *
 * Server component: autentica, valida tenant, valida permissão, carrega,
 * DECIFRA no servidor e entrega DTO. Três autores distintos na timeline —
 * paciente, agente e humano —, porque `direction` sozinho não separa quem do
 * lado da clínica falou.
 *
 * O selo de entrega das mensagens humanas vem de outbound_messages: uma
 * mensagem persistida ainda não é uma mensagem entregue, e dizer "enviada"
 * antes da confirmação engana o operador.
 */
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getConversationThread } from '@/contexts/ai-agent/queries';
import type { AIConversationStatus, AIThreadMessage } from '@/contexts/ai-agent/types';
import { getProfileNames } from '@/contexts/identity/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import { cn } from '@/lib/ui/cn';

import { ConversaActions } from './_components/conversa-actions';
import { RetryMessageButton } from './_components/retry-message-button';
import { ConversasNoAccess } from '../_components/no-access';
import { ConversationAutoRefresh } from '../_components/conversation-auto-refresh';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<AIConversationStatus, 'amber' | 'green' | 'gray'> = {
  handoff: 'amber',
  active: 'green',
  closed: 'gray',
  abandoned: 'gray',
};

const STATUS_LABEL: Record<AIConversationStatus, string> = {
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

export default async function ConversaThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user.permissions.includes(PERMISSIONS.VIEW_CONVERSATIONS)) return <ConversasNoAccess />;
  const clinicId = await requireClinicId();

  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();

  const thread = await getConversationThread(clinicId, parsed.data);
  if (!thread) notFound();

  const titulo = thread.patientDisplayName ?? thread.maskedPhone ?? 'Contato desconhecido';
  const canManage = user.permissions.includes(PERMISSIONS.MANAGE_CONVERSATIONS);
  const assigneeNames = await getProfileNames(
    clinicId,
    thread.handoff?.assignedToUserId ? [thread.handoff.assignedToUserId] : [],
  );
  const assignedToName = thread.handoff?.assignedToUserId
    ? (assigneeNames.get(thread.handoff.assignedToUserId) ?? 'Membro da equipe')
    : null;
  const failedDeliveries = thread.messages.filter(
    (message) => message.delivery === 'failed',
  ).length;
  const canRetryFailedMessages =
    canManage &&
    thread.status === 'handoff' &&
    thread.handoff?.assignedToUserId === user.userId &&
    thread.window.open;

  return (
    <>
      <ConversationAutoRefresh />
      <PageHeader
        crumbs={[
          { label: 'Gestão' },
          { label: 'Conversas IA', href: '/conversas' },
          { label: titulo },
        ]}
        title={titulo}
        description={`Iniciada em ${new Date(thread.startedAt).toLocaleString('pt-BR')}${
          thread.intentAtual ? ` · intenção atual: ${thread.intentAtual}` : ''
        }`}
        actions={
          <Badge tone={STATUS_TONE[thread.status]} dot>
            {STATUS_LABEL[thread.status]}
          </Badge>
        }
      />

      <div className="flex flex-col gap-(--sp-5)">
        {failedDeliveries > 0 ? (
          <Alert variant="danger" title="Falha de entrega no WhatsApp">
            {failedDeliveries} mensagem{failedDeliveries === 1 ? '' : 'ns'} não foi
            {failedDeliveries === 1 ? '' : 'ram'} entregue{failedDeliveries === 1 ? '' : 's'}. Use o
            reenvio ao lado da mensagem após confirmar que o número e a conexão estão corretos.
          </Alert>
        ) : null}
        <PanelCard
          title="Histórico"
          meta={`${thread.messages.length} mensagem${thread.messages.length === 1 ? '' : 's'}`}
        >
          <ol className="flex flex-col gap-(--sp-4)">
            {thread.messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'flex flex-col gap-1',
                  m.direction === 'in' ? 'items-start' : 'items-end',
                )}
              >
                <div
                  className={cn(
                    'max-w-[min(42rem,85%)] rounded-(--r-md) px-3.5 py-2.5 text-(length:--fs-sm) whitespace-pre-wrap',
                    m.author === 'patient' && 'bg-surface-inset text-fg',
                    m.author === 'agent' &&
                      'bg-info-50 text-fg dark:bg-[color-mix(in_oklch,var(--info-500)_14%,transparent)]',
                    m.author === 'human' && 'bg-primary text-on-primary',
                  )}
                >
                  {m.text}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-(length:--fs-xs) text-fg-subtle">
                  <span>{AUTHOR_LABEL[m.author]}</span>
                  <span>·</span>
                  <time dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleString('pt-BR')}
                  </time>
                  {m.delivery ? (
                    <>
                      <span>·</span>
                      <span className={cn(m.delivery === 'failed' && 'text-danger-600')}>
                        {DELIVERY_LABEL[m.delivery]}
                      </span>
                    </>
                  ) : null}
                </div>
                {m.delivery === 'failed' && canRetryFailedMessages ? (
                  <RetryMessageButton conversationId={thread.id} messageId={m.id} />
                ) : null}
                {m.meta ? <AgentMeta meta={m.meta} /> : null}
              </li>
            ))}
          </ol>
          {thread.messages.length === 0 ? (
            <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma mensagem nesta conversa.</p>
          ) : null}
        </PanelCard>

        <PanelCard title="Atendimento humano">
          <ConversaActions
            conversationId={thread.id}
            status={thread.status}
            windowOpen={thread.window.open}
            windowClosesAt={thread.window.closesAt}
            lastInboundAt={thread.window.lastInboundAt}
            canManage={canManage}
            handoff={thread.handoff}
            currentUserId={user.userId}
            assignedToName={assignedToName}
          />
        </PanelCard>
      </div>
    </>
  );
}

/**
 * Metadados operacionais do turno do agente — para entender POR QUE ele
 * respondeu aquilo. Nunca inclui o prompt snapshot (ADR-047: replay é
 * ferramenta de engenharia, não de painel).
 */
function AgentMeta({ meta }: { meta: NonNullable<AIThreadMessage['meta']> }) {
  const parts: string[] = [];
  if (meta.intent) parts.push(`intent: ${meta.intent}`);
  if (meta.model) parts.push(meta.model);
  if (meta.latencyMs !== null) parts.push(`${meta.latencyMs} ms`);
  if (meta.costUsd !== null) parts.push(`US$ ${meta.costUsd.toFixed(4)}`);
  const tools = Array.isArray(meta.toolCalls) ? meta.toolCalls.length : 0;
  if (tools > 0) parts.push(`${tools} tool call${tools === 1 ? '' : 's'}`);
  if (parts.length === 0) return null;
  return <p className="text-(length:--fs-xs) text-fg-subtle tabular-nums">{parts.join(' · ')}</p>;
}
