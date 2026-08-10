/**
 * /conversas — fila de conversas do agente de IA com pacientes (ADR-047).
 *
 * Server component, só leitura. Tenant via requireClinicId + RLS; decifragem no
 * servidor (queries.ts) e o que chega aqui já é DTO — nunca row de banco.
 *
 * Ordenação: 'handoff' primeiro. Não é estética — é a fila de quem está
 * esperando um humano; enterrá-la sob conversas ativas é o mesmo que não ter a
 * tela.
 */
import { AlertTriangle, MessagesSquare, Search } from 'lucide-react';
import Link from 'next/link';

import { listConversations } from '@/contexts/ai-agent/queries';
import type { AIConversationStatus } from '@/contexts/ai-agent/types';
import { getProfileNames } from '@/contexts/identity/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { fieldControlClassName } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TablePager } from '@/components/ui/table-pager';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { cn } from '@/lib/ui/cn';

import { ConversasNoAccess } from './_components/no-access';
import { ConversationAutoRefresh } from './_components/conversation-auto-refresh';

export const dynamic = 'force-dynamic';

type SP = { q?: string; status?: string; sla?: string; page?: string };

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

function isStatus(v: string | undefined): v is AIConversationStatus {
  return v === 'active' || v === 'handoff' || v === 'closed' || v === 'abandoned';
}

function qstring(sp: SP, extra: { [K in keyof SP]?: string | undefined }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export default async function ConversasPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  // Render amigável (não throw): o menu mostra o módulo a todos, então quem não
  // tem a permission chegaria aqui e tomaria um 500 (ADR-047).
  if (!user.permissions.includes(PERMISSIONS.VIEW_CONVERSATIONS)) return <ConversasNoAccess />;
  const clinicId = await requireClinicId();

  const sp = await searchParams;
  const status = isStatus(sp.status) ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const q = sp.q?.trim() || undefined;
  const overdueOnly = sp.sla === 'overdue';

  const result = await listConversations(clinicId, {
    ...(status ? { status } : {}),
    ...(q ? { search: q } : {}),
    ...(overdueOnly ? { overdueOnly: true } : {}),
    page,
  });

  const filtrando = Boolean(q || status || overdueOnly);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const aguardando = result.items.filter((c) => c.status === 'handoff').length;
  const podeAtuar = user.permissions.includes(PERMISSIONS.MANAGE_CONVERSATIONS);
  const assigneeNames = await getProfileNames(
    clinicId,
    result.items.flatMap((item) => item.handoff?.assignedToUserId ?? []),
  );

  return (
    <>
      <ConversationAutoRefresh />
      <PageHeader
        crumbs={[{ label: 'Gestão' }, { label: 'Conversas IA' }]}
        title="Conversas IA"
        description={
          podeAtuar
            ? 'Conversas do agente com pacientes. Assuma uma conversa para responder pelo painel.'
            : 'Conversas do agente com pacientes.'
        }
      />

      <TableWrap>
        <TableToolbar>
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="relative block min-w-52 flex-1 sm:max-w-90">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              />
              <input
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Buscar por paciente ou telefone…"
                aria-label="Buscar conversas por nome do paciente ou telefone"
                className={cn(fieldControlClassName, 'pl-9')}
              />
            </span>
            <Select
              name="status"
              defaultValue={status ?? ''}
              aria-label="Filtrar por status"
              className="max-w-52"
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
            >
              <option value="">Todos os prazos</option>
              <option value="overdue">SLA vencido</option>
            </Select>
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Filtrar
            </button>
          </form>
        </TableToolbar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare />}
            title={filtrando ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
            description={
              filtrando
                ? 'Ajuste a busca ou o filtro de status.'
                : 'Quando um paciente escrever no WhatsApp da clínica, a conversa aparece aqui.'
            }
          />
        ) : (
          <>
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Última mensagem</TableHead>
                    <TableHead className="w-44">Status</TableHead>
                    <TableHead className="w-52">Atendimento</TableHead>
                    <TableHead className="w-40">Atualizada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="p-0">
                        <Link
                          href={`/conversas/${c.id}`}
                          className="block px-3.5 py-(--cell-py) font-medium"
                        >
                          {c.patientDisplayName ?? c.maskedPhone ?? 'Contato desconhecido'}
                          {c.intentAtual ? (
                            <span className="ml-2 text-(length:--fs-xs) font-normal text-fg-subtle">
                              {c.intentAtual}
                            </span>
                          ) : null}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-100 truncate text-fg-muted">
                        {c.lastMessagePreview ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[c.status]} dot>
                          {STATUS_LABEL[c.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {c.handoff ? (
                          <div className="flex flex-col gap-0.5 text-xs">
                            <span
                              className={
                                c.handoff.overdue
                                  ? 'font-semibold text-danger-700'
                                  : 'text-fg-muted'
                              }
                            >
                              {c.handoff.overdue ? (
                                <AlertTriangle className="mr-1 inline size-3.5" />
                              ) : null}
                              {c.handoff.overdue
                                ? 'SLA vencido'
                                : `Até ${new Date(c.handoff.dueAt).toLocaleTimeString('pt-BR', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}`}
                            </span>
                            <span className="text-fg-subtle">
                              {c.handoff.assignedToUserId
                                ? (assigneeNames.get(c.handoff.assignedToUserId) ??
                                  'Responsável atribuído')
                                : 'Sem responsável'}
                              {c.handoff.priority === 'urgent' ? ' · urgente' : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {new Date(c.lastMessageAt).toLocaleString('pt-BR')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
            <TableFoot>
              <TableFootInfo>
                Página {page} de {totalPages} · {result.total} conversa
                {result.total === 1 ? '' : 's'}
                {aguardando > 0 ? ` · ${aguardando} aguardando humano nesta página` : ''}
              </TableFootInfo>
              <TablePager
                page={page}
                pageCount={totalPages}
                hrefFor={(p) => `/conversas${qstring(sp, { page: String(p) })}`}
              />
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
