/** Rota direta preservada; reutiliza o mesmo histórico e atendimento da inbox. */
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { readConversationThread } from '@/contexts/ai-agent/conversation-access';
import { getProfileNames } from '@/contexts/identity/queries';
import { pageGate } from '@/lib/auth/page-guard';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { identidadeDoContato } from '../contact-identity';
import { ConversasNoAccess } from '../_components/no-access';
import { ConversationAutoRefresh } from '../_components/conversation-auto-refresh';
import { ConversationThread } from '../_components/conversation-thread';
export const dynamic = 'force-dynamic';
export default async function ConversaThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await pageGate([PERMISSIONS.VIEW_CONVERSATIONS]);
  if (!gate.allowed) return <ConversasNoAccess />;
  const { user, clinicId } = gate;
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const thread = await readConversationThread(clinicId, parsed.data, 'conversa_direta');
  if (!thread) notFound();
  const assigneeNames = await getProfileNames(
    clinicId,
    thread.handoff?.assignedToUserId ? [thread.handoff.assignedToUserId] : [],
  );
  const assignedToName = thread.handoff?.assignedToUserId
    ? (assigneeNames.get(thread.handoff.assignedToUserId) ?? 'Membro da equipe')
    : null;
  const title = identidadeDoContato(thread).titulo;
  return (
    <>
      <ConversationAutoRefresh />
      <PageHeader
        crumbs={[
          { label: 'Gestão' },
          { label: 'Conversas IA', href: '/conversas' },
          { label: title },
        ]}
        title="Conversas IA"
        description="Histórico e atendimento do contato."
      />
      <ConversationThread
        thread={thread}
        canManage={user.permissions.includes(PERMISSIONS.MANAGE_CONVERSATIONS)}
        currentUserId={user.userId}
        assignedToName={assignedToName}
      />
    </>
  );
}
