import { AlertTriangle, ShieldCheck } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { listEmployees } from '@/contexts/identity/queries';
import { listLgpdRequestHistory, listLgpdRequests } from '@/contexts/patient/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  AuthError,
  requireClinicId,
  requireFreshPermission,
  requireUser,
} from '@/lib/auth/tenant-context';
import { uuidv4 } from '@/lib/ui/uuid';

import { assignLgpdRequestForm, notifyLgpdRequesterForm, processLgpdRequestForm } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL = {
  pending: 'Pendente',
  processing: 'Em tratamento',
  completed: 'Concluido',
  failed: 'Falhou',
} as const;

export default async function LgpdOperationsPage() {
  await requireUser();
  // A lista contém dados de solicitações de titulares. Antes de qualquer query,
  // a negativa precisa ser uma tela segura — não uma exceção/Sentry esperada.
  try {
    await requireFreshPermission(PERMISSIONS.EXPORT_PATIENT);
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== 'forbidden') throw error;
    return (
      <>
        <PageHeader
          title="Solicitações LGPD"
          description="Responsável, prazo de resposta, tratamento e comunicação ao titular."
        />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para operar solicitações LGPD.
        </Alert>
      </>
    );
  }
  const clinicId = await requireClinicId();
  const [requests, employees] = await Promise.all([
    listLgpdRequests(clinicId),
    listEmployees(clinicId),
  ]);
  const managers = employees.filter(
    (employee) =>
      employee.ativo &&
      !employee.pending &&
      (employee.role === 'owner' || employee.role === 'gestor'),
  );
  const histories = new Map(
    await Promise.all(
      requests.map(
        async (request) =>
          [request.id, await listLgpdRequestHistory(clinicId, request.id)] as const,
      ),
    ),
  );
  const names = new Map(employees.map((employee) => [employee.id, employee.nome]));

  return (
    <>
      <PageHeader
        title="Solicitacoes LGPD"
        description="Responsavel, prazo de resposta, tratamento e comunicacao ao titular."
      />
      {requests.length === 0 ? (
        <Card className="p-(--card-pad) text-sm text-fg-muted">
          Nenhuma solicitacao registrada.
        </Card>
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => (
            <Card key={request.id} className="p-(--card-pad)">
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid size-9 place-items-center rounded-(--r-md) bg-primary-soft text-primary">
                  {request.overdue ? (
                    <AlertTriangle className="size-4" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{request.patientName ?? `Paciente ${request.patientId}`}</strong>
                    <span className="text-xs text-fg-muted">
                      {request.type === 'export' ? 'Exportacao' : 'Exclusao'}
                    </span>
                    <span
                      className={
                        request.overdue
                          ? 'text-xs font-semibold text-danger-700'
                          : 'text-xs text-fg-muted'
                      }
                    >
                      {request.overdue ? 'SLA vencido' : STATUS_LABEL[request.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">
                    Prazo: {new Date(request.dueAt).toLocaleString('pt-BR')} · Responsavel:{' '}
                    {request.assignedToUserId
                      ? (names.get(request.assignedToUserId) ?? 'Usuario removido')
                      : 'Nao atribuido'}
                  </p>
                  {request.statusReason ? (
                    <p className="mt-1 text-xs text-fg-subtle">{request.statusReason}</p>
                  ) : null}
                  {request.requesterNotifiedAt ? (
                    <p className="mt-1 text-xs text-success-700">
                      Titular notificado em{' '}
                      {new Date(request.requesterNotifiedAt).toLocaleString('pt-BR')}.
                    </p>
                  ) : null}
                  {request.exportSignedUrl &&
                  request.exportSignedUrlExpiresAt &&
                  new Date(request.exportSignedUrlExpiresAt) > new Date() ? (
                    <a
                      className="mt-2 inline-block text-xs text-primary underline"
                      href={request.exportSignedUrl}
                    >
                      Abrir exportacao segura
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <form action={assignLgpdRequestForm} className="flex gap-2">
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="idempotencyKey" value={uuidv4()} />
                  <Select
                    name="assignedToUserId"
                    defaultValue={request.assignedToUserId ?? ''}
                    required
                  >
                    <option value="" disabled>
                      Responsavel
                    </option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.nome}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="secondary">
                    Atribuir
                  </Button>
                </form>

                {request.status === 'pending' || request.status === 'failed' ? (
                  <form action={processLgpdRequestForm} className="flex gap-2">
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="idempotencyKey" value={uuidv4()} />
                    <Input
                      name="reason"
                      placeholder="Identidade verificada por..."
                      required
                      minLength={3}
                    />
                    <Button size="sm">Processar</Button>
                  </form>
                ) : null}

                {request.status !== 'pending' && !request.requesterNotifiedAt ? (
                  <form
                    action={notifyLgpdRequesterForm}
                    className="grid gap-2 sm:grid-cols-[auto_1fr_auto]"
                  >
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="idempotencyKey" value={uuidv4()} />
                    <Select name="channel" required defaultValue="email">
                      <option value="email">E-mail</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="phone">Telefone</option>
                      <option value="in_person">Presencial</option>
                    </Select>
                    <Input
                      name="note"
                      placeholder="Comprovacao da comunicacao"
                      required
                      minLength={3}
                    />
                    <Button size="sm" variant="secondary">
                      Marcar notificado
                    </Button>
                  </form>
                ) : null}
              </div>

              <details className="mt-4 text-xs text-fg-muted">
                <summary className="cursor-pointer">Historico de tratamento</summary>
                <ul className="mt-2 grid gap-1">
                  {(histories.get(request.id) ?? []).map((entry) => (
                    <li key={entry.id}>
                      {new Date(entry.changedAt).toLocaleString('pt-BR')} · {entry.action}
                      {entry.note ? ` · ${entry.note}` : ''}
                      {entry.changedByUserId
                        ? ` · ${names.get(entry.changedByUserId) ?? 'Sistema'}`
                        : ' · Sistema'}
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
