import { AlertTriangle, ExternalLink, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableCellStack,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TableToolbar } from '@/components/ui/table-toolbar';
import type { LgpdRequestDTO, LgpdRequestHistoryDTO } from '@/contexts/patient/queries';
import { cn } from '@/lib/ui/cn';
import { uuidv4 } from '@/lib/ui/uuid';

import { assignLgpdRequestForm, notifyLgpdRequesterForm, processLgpdRequestForm } from './actions';

const STATUS_META = {
  pending: { label: 'Pendente', tone: 'amber' },
  processing: { label: 'Em tratamento', tone: 'blue' },
  completed: { label: 'Concluído', tone: 'green' },
  failed: { label: 'Falhou', tone: 'red' },
} as const;

const ACTION_LABEL = {
  created: 'Solicitação criada',
  assigned: 'Responsável alterado',
  status_changed: 'Status alterado',
  notified: 'Titular notificado',
} as const;

const CHANNEL_LABEL = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  in_person: 'Presencial',
} as const;

type ManagerOption = { id: string; nome: string };

function formatDateTime(value: string, timeZone: string): string {
  return new Date(value).toLocaleString('pt-BR', { timeZone });
}

function patientName(request: LgpdRequestDTO): string {
  return request.patientName ?? `Paciente ${request.patientId}`;
}

function RequestStatus({ request }: { request: LgpdRequestDTO }) {
  const status = STATUS_META[request.status];
  return (
    <Badge tone={request.overdue ? 'red' : status.tone} dot>
      {request.overdue ? 'Prazo legal vencido' : status.label}
    </Badge>
  );
}

function RequestDetail({
  request,
  history,
  managers,
  names,
  timeZone,
}: {
  request: LgpdRequestDTO;
  history: LgpdRequestHistoryDTO[];
  managers: ManagerOption[];
  names: Map<string, string>;
  timeZone: string;
}) {
  const displayName = patientName(request);
  const validExportUrl =
    request.exportSignedUrl &&
    request.exportSignedUrlExpiresAt &&
    new Date(request.exportSignedUrlExpiresAt) > new Date()
      ? request.exportSignedUrl
      : null;

  return (
    <aside aria-labelledby="lgpd-detail-title" className="order-first min-w-0 xl:order-none">
      <Card className="overflow-hidden p-0">
        <div className="flex items-start gap-3 border-b border-border px-(--sp-4) py-(--sp-4)">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-(--r-md)',
              request.overdue
                ? 'bg-danger-50 text-danger-700 dark:bg-[color-mix(in_oklch,var(--danger-500)_18%,transparent)]'
                : 'bg-(--primary-soft) text-primary',
            )}
          >
            {request.overdue ? (
              <AlertTriangle className="size-4" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="lgpd-detail-title" className="text-balance text-sm font-semibold text-fg">
              {displayName}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="gray">{request.type === 'export' ? 'Exportação' : 'Exclusão'}</Badge>
              <RequestStatus request={request} />
            </div>
          </div>
          <Link
            href="/configuracoes/lgpd"
            aria-label="Fechar detalhes"
            className={buttonVariants({ variant: 'ghost', size: 'sm', icon: true })}
          >
            <X aria-hidden="true" className="size-4" />
          </Link>
        </div>

        <div className="grid gap-(--sp-5) p-(--sp-4)">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div>
              <dt className="text-fg-subtle">Solicitada em</dt>
              <dd className="mt-0.5 text-fg tabular-nums">
                {formatDateTime(request.requestedAt, timeZone)}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Prazo</dt>
              <dd
                className={cn(
                  'mt-0.5 tabular-nums',
                  request.overdue ? 'font-semibold text-danger-700' : 'text-fg',
                )}
              >
                {formatDateTime(request.dueAt, timeZone)}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Responsável</dt>
              <dd className="mt-0.5 text-fg">
                {request.assignedToUserId
                  ? (names.get(request.assignedToUserId) ?? 'Usuário removido')
                  : 'Não atribuído'}
              </dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Comunicação</dt>
              <dd className="mt-0.5 text-fg">
                {request.requesterNotifiedAt
                  ? `${formatDateTime(request.requesterNotifiedAt, timeZone)} · ${
                      request.requesterNotificationChannel
                        ? CHANNEL_LABEL[request.requesterNotificationChannel]
                        : 'Canal não informado'
                    }`
                  : 'Pendente'}
              </dd>
            </div>
          </dl>

          {request.statusReason ? (
            <div className="rounded-(--r-md) bg-surface-inset px-3 py-2.5 text-pretty text-xs text-fg-muted">
              {request.statusReason}
            </div>
          ) : null}

          {validExportUrl ? (
            <a className={buttonVariants({ variant: 'secondary' })} href={validExportUrl}>
              <ExternalLink aria-hidden="true" className="size-4" />
              Abrir exportação segura
            </a>
          ) : null}

          <section aria-labelledby="lgpd-actions-title" className="grid gap-4">
            <h3 id="lgpd-actions-title" className="text-balance text-sm font-semibold text-fg">
              Tratamento
            </h3>

            <form action={assignLgpdRequestForm} className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="idempotencyKey" value={uuidv4()} />
              <Field
                label="Responsável"
                htmlFor={`lgpd-assignee-${request.id}`}
                className="sm:col-span-2"
              >
                <Select
                  id={`lgpd-assignee-${request.id}`}
                  name="assignedToUserId"
                  defaultValue={request.assignedToUserId ?? ''}
                  required
                >
                  <option value="" disabled>
                    Selecione um responsável
                  </option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary" className="min-h-(--hit-target) sm:col-start-2">
                Atribuir
              </Button>
            </form>

            {request.status === 'pending' || request.status === 'failed' ? (
              <form action={processLgpdRequestForm} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="idempotencyKey" value={uuidv4()} />
                <Field
                  label="Comprovação da identidade"
                  htmlFor={`lgpd-reason-${request.id}`}
                  className="sm:col-span-2"
                >
                  <Input
                    id={`lgpd-reason-${request.id}`}
                    name="reason"
                    placeholder="Identidade verificada por..."
                    required
                    minLength={3}
                  />
                </Field>
                <Button className="min-h-(--hit-target) sm:col-start-2">Processar</Button>
              </form>
            ) : null}

            {request.status !== 'pending' && !request.requesterNotifiedAt ? (
              <form action={notifyLgpdRequesterForm} className="grid gap-3">
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="idempotencyKey" value={uuidv4()} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Canal" htmlFor={`lgpd-channel-${request.id}`}>
                    <Select
                      id={`lgpd-channel-${request.id}`}
                      name="channel"
                      required
                      defaultValue="email"
                    >
                      <option value="email">E-mail</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="phone">Telefone</option>
                      <option value="in_person">Presencial</option>
                    </Select>
                  </Field>
                  <Field label="Comprovação da comunicação" htmlFor={`lgpd-note-${request.id}`}>
                    <Input
                      id={`lgpd-note-${request.id}`}
                      name="note"
                      placeholder="Protocolo ou observação"
                      required
                      minLength={3}
                    />
                  </Field>
                </div>
                <Button variant="secondary" className="min-h-(--hit-target) justify-self-end">
                  Marcar notificado
                </Button>
              </form>
            ) : null}
          </section>

          <section aria-labelledby="lgpd-history-title" className="border-t border-border pt-4">
            <h3 id="lgpd-history-title" className="text-balance text-sm font-semibold text-fg">
              Histórico de tratamento
            </h3>
            {history.length === 0 ? (
              <p className="mt-2 text-pretty text-xs text-fg-subtle">
                Nenhum evento registrado para esta solicitação.
              </p>
            ) : (
              <ol className="mt-2 grid gap-0">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="border-b border-border py-2.5 text-xs last:border-b-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <strong className="font-medium text-fg">{ACTION_LABEL[entry.action]}</strong>
                      <time className="text-fg-subtle tabular-nums" dateTime={entry.changedAt}>
                        {formatDateTime(entry.changedAt, timeZone)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-pretty text-fg-muted">
                      {entry.note ? `${entry.note} · ` : ''}
                      {entry.changedByUserId
                        ? (names.get(entry.changedByUserId) ?? 'Sistema')
                        : 'Sistema'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </Card>
    </aside>
  );
}

export function LgpdWorkQueue({
  requests,
  selectedRequest,
  history,
  managers,
  names,
  timeZone,
}: {
  requests: LgpdRequestDTO[];
  selectedRequest: LgpdRequestDTO | null;
  history: LgpdRequestHistoryDTO[];
  managers: ManagerOption[];
  names: Map<string, string>;
  timeZone: string;
}) {
  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Nenhuma solicitação registrada"
        description="Novas solicitações de titulares aparecerão nesta fila."
      />
    );
  }

  const overdueCount = requests.filter((request) => request.overdue).length;

  return (
    <div
      className={cn(
        'grid min-w-0 gap-4',
        selectedRequest && 'xl:grid-cols-[minmax(0,1.6fr)_minmax(22rem,1fr)]',
      )}
    >
      <section aria-labelledby="lgpd-queue-title" className="min-w-0">
        <h2 id="lgpd-queue-title" className="sr-only">
          Fila de solicitações LGPD
        </h2>
        <TableWrap>
          <TableToolbar>
            <span className="text-sm font-medium text-fg">
              {requests.length} solicitaç{requests.length === 1 ? 'ão' : 'ões'}
            </span>
            {overdueCount > 0 ? (
              <Badge tone="red" dot>
                {overdueCount} com prazo legal vencido
              </Badge>
            ) : (
              <Badge tone="green" dot>
                Prazos legais em dia
              </Badge>
            )}
          </TableToolbar>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Solicitação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => {
                  const displayName = patientName(request);
                  return (
                    <TableRow key={request.id} selected={selectedRequest?.id === request.id}>
                      <TableCell>
                        <TableCellStack
                          main={displayName}
                          sub={`Solicitada em ${formatDateTime(request.requestedAt, timeZone)}`}
                        />
                      </TableCell>
                      <TableCell>{request.type === 'export' ? 'Exportação' : 'Exclusão'}</TableCell>
                      <TableCell>
                        <RequestStatus request={request} />
                      </TableCell>
                      <TableCell
                        className={cn(
                          'whitespace-nowrap tabular-nums',
                          request.overdue && 'font-semibold text-danger-700',
                        )}
                      >
                        {formatDateTime(request.dueAt, timeZone)}
                      </TableCell>
                      <TableCell>
                        {request.assignedToUserId
                          ? (names.get(request.assignedToUserId) ?? 'Usuário removido')
                          : 'Não atribuído'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/configuracoes/lgpd?solicitacao=${request.id}`}
                          aria-label={`Abrir solicitação de ${displayName}`}
                          className={cn(
                            buttonVariants({ variant: 'ghost', size: 'sm' }),
                            'min-h-(--hit-target)',
                          )}
                        >
                          Abrir
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
          <TableFoot>
            <TableFootInfo className="tabular-nums">
              {requests.length} solicitaç{requests.length === 1 ? 'ão' : 'ões'} na fila
            </TableFootInfo>
          </TableFoot>
        </TableWrap>
      </section>

      {selectedRequest ? (
        <RequestDetail
          request={selectedRequest}
          history={history}
          managers={managers}
          names={names}
          timeZone={timeZone}
        />
      ) : null}
    </div>
  );
}
