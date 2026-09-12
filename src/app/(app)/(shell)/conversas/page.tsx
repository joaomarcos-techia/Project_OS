/** Inbox renderizada no servidor: permissão antes de ler e decifrar qualquer contato. */
import { MessagesSquare, SlidersHorizontal, Timer } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import {
  countOpenHandoffs,
  getConversationThread,
  listConversations,
} from '@/contexts/ai-agent/queries';
import type { AIConversationStatus } from '@/contexts/ai-agent/types';
import { getProfileNames } from '@/contexts/identity/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { cn } from '@/lib/ui/cn';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar, SearchField } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { TablePager } from '@/components/ui/table-pager';
import { identidadeDoContato } from './contact-identity';
import { apresentacaoDoStatus, prazoRelativo } from './status-presentation';
import { ConversasNoAccess } from './_components/no-access';
import { ConversationAutoRefresh } from './_components/conversation-auto-refresh';
import { ConversationThread } from './_components/conversation-thread';
import styles from './conversations.module.css';

export const dynamic = 'force-dynamic';
type SP = { q?: string; status?: string; sla?: string; page?: string; conversation?: string };
function isStatus(value: string | undefined): value is AIConversationStatus {
  return value === 'active' || value === 'handoff' || value === 'closed' || value === 'abandoned';
}
function qstring(sp: SP, extra: { [K in keyof SP]?: string | undefined }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...sp, ...extra })) if (value) params.set(key, value);
  return params.size ? `?${params.toString()}` : '';
}
export default async function ConversasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  if (!user.permissions.includes(PERMISSIONS.VIEW_CONVERSATIONS)) return <ConversasNoAccess />;
  const clinicId = await requireClinicId();
  const sp = await searchParams;
  const status = isStatus(sp.status) ? sp.status : undefined;
  const parsedPage = Number(sp.page ?? '1');
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const q = sp.q?.trim() || undefined;
  const overdueOnly = sp.sla === 'overdue';
  const result = await listConversations(clinicId, {
    ...(status ? { status } : {}),
    ...(q ? { search: q } : {}),
    ...(overdueOnly ? { overdueOnly: true } : {}),
    page,
  });
  const selection = z.string().uuid().safeParse(sp.conversation);
  const selected =
    (selection.success ? result.items.find((item) => item.id === selection.data) : undefined) ??
    result.items[0];
  const thread = selected ? await getConversationThread(clinicId, selected.id) : null;
  const assigneeIds = result.items.flatMap((item) => item.handoff?.assignedToUserId ?? []);
  if (thread?.handoff?.assignedToUserId) assigneeIds.push(thread.handoff.assignedToUserId);
  const assigneeNames = await getProfileNames(clinicId, [...new Set(assigneeIds)]);
  const assignedToName = thread?.handoff?.assignedToUserId
    ? (assigneeNames.get(thread.handoff.assignedToUserId) ?? 'Membro da equipe')
    : null;
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  // Pulso da fila inteira, não só da página visível: quem abre a tela precisa
  // saber quantos esperam no total, e a paginação esconderia isso.
  const pulso = await countOpenHandoffs(clinicId);
  const filtering = Boolean(q || status || overdueOnly);
  const hasExplicitSelection =
    selection.success && selected?.id === selection.data && Boolean(thread);
  return (
    <>
      <ConversationAutoRefresh />
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Conversas IA' }]}
        title="Conversas IA"
        description="Agente no WhatsApp e fila de atendimento humano"
        {...(pulso.abertos > 0
          ? {
              meta: (
                <span className="font-mono tabular-nums">
                  {pulso.abertos} aguardando humano
                  {pulso.vencidos > 0 ? ` · ${pulso.vencidos} SLA vencido` : ''}
                </span>
              ),
            }
          : {})}
        actions={
          <Link href="/configuracoes/agente" className={buttonVariants({ variant: 'secondary' })}>
            <SlidersHorizontal aria-hidden="true" className="size-4 text-fg-subtle" />
            Configurar o agente
          </Link>
        }
      />
      <FilterBar className="qoro-toolbar">
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-(--sp-2)">
          <SearchField
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Buscar por paciente ou telefone…"
            aria-label="Buscar conversas por nome do paciente ou telefone"
            className="sm:max-w-68"
          />
          <Select
            name="status"
            defaultValue={status ?? ''}
            aria-label="Filtrar por status"
            className="max-w-48"
          >
            <option value="">Todos os status</option>
            <option value="handoff">Aguardando humano</option>
            <option value="active">Agente respondendo</option>
            <option value="closed">Encerradas</option>
            <option value="abandoned">Abandonadas</option>
          </Select>
          <Select
            name="sla"
            defaultValue={overdueOnly ? 'overdue' : ''}
            aria-label="Filtrar por SLA"
            className="max-w-44"
          >
            <option value="">Todos os prazos</option>
            <option value="overdue">SLA vencido</option>
          </Select>
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Filtrar
          </button>
          <span className={styles.count}>
            {result.total.toLocaleString('pt-BR')} conversa{result.total === 1 ? '' : 's'}
          </span>
        </form>
      </FilterBar>
      <div className={cn('qoro-fill', styles.workspace)} data-detail={hasExplicitSelection}>
        <section className={styles.inbox} aria-label="Lista de conversas">
          <div className={styles.inboxHeader}>
            <h2>Conversas</h2>
            <span className={styles.inboxCount}>{result.total.toLocaleString('pt-BR')}</span>
            <span className={styles.inboxOrder}>mais recentes primeiro</span>
          </div>
          {result.items.length === 0 ? (
            <EmptyState
              icon={<MessagesSquare />}
              title={filtering ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
              description={
                filtering
                  ? 'Ajuste a busca ou os filtros.'
                  : 'Quando um paciente escrever no WhatsApp da clínica, a conversa aparece aqui.'
              }
            />
          ) : (
            <>
              <ul className={styles.contacts}>
                {result.items.map((item) => {
                  const contato = identidadeDoContato(item);
                  const estado = apresentacaoDoStatus({
                    ...item,
                    assignedToName: item.handoff?.assignedToUserId
                      ? (assigneeNames.get(item.handoff.assignedToUserId) ??
                        'Responsável atribuído')
                      : null,
                  });
                  return (
                    <li key={item.id}>
                      <Link
                        className={styles.contact}
                        href={`/conversas${qstring(sp, { conversation: item.id })}`}
                        aria-current={selected?.id === item.id ? 'true' : undefined}
                      >
                        <Avatar name={item.patientDisplayName ?? 'Contato'} />
                        <div className={styles.contactBody}>
                          <div className={styles.contactTitle}>
                            <strong>{contato.titulo}</strong>
                            <time
                              dateTime={item.lastMessageAt}
                              title={new Date(item.lastMessageAt).toLocaleString('pt-BR')}
                            >
                              {new Date(item.lastMessageAt).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                              })}{' '}
                              {new Date(item.lastMessageAt).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </time>
                          </div>
                          {contato.telefone ? (
                            <span className={styles.phone}>{contato.telefone}</span>
                          ) : null}
                          <p className={styles.preview}>
                            {item.lastMessagePreview ?? 'Nenhuma mensagem ainda'}
                          </p>
                          <div className={styles.contactStatus} data-tone={estado.tone}>
                            <estado.Icon aria-hidden="true" size={12} />
                            <span>{estado.label}</span>
                            {estado.badge ? <Badge tone="gray">{estado.badge.label}</Badge> : null}
                            {item.handoff ? (
                              <Badge tone={item.handoff.overdue ? 'red' : 'amber'}>
                                <Timer aria-hidden="true" className="size-3" />
                                {prazoRelativo(item.handoff.dueAt)}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className={styles.pagination}>
                <span>
                  {((page - 1) * result.pageSize + 1).toLocaleString('pt-BR')}–
                  {Math.min(page * result.pageSize, result.total).toLocaleString('pt-BR')} de{' '}
                  {result.total.toLocaleString('pt-BR')}
                </span>
                {totalPages > 1 ? (
                  <TablePager
                    page={page}
                    pageCount={totalPages}
                    hrefFor={(next) =>
                      `/conversas${qstring(sp, { page: String(next), conversation: undefined })}`
                    }
                  />
                ) : null}
              </div>
            </>
          )}
        </section>
        {thread ? (
          <ConversationThread
            thread={thread}
            canManage={user.permissions.includes(PERMISSIONS.MANAGE_CONVERSATIONS)}
            currentUserId={user.userId}
            assignedToName={assignedToName}
            backHref={`/conversas${qstring(sp, { conversation: undefined })}`}
          />
        ) : (
          <div className={styles.emptyThread}>
            <EmptyState
              icon={<MessagesSquare />}
              title="Selecione uma conversa"
              description="O histórico e as opções de atendimento aparecem aqui."
            />
          </div>
        )}
      </div>
    </>
  );
}
