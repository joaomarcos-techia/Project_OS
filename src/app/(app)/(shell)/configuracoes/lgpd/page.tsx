import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { listEmployees } from '@/contexts/identity/queries';
import { listLgpdRequestHistory, listLgpdRequests } from '@/contexts/patient/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  AuthError,
  requireClinicId,
  requireFreshPermission,
  requireUser,
} from '@/lib/auth/tenant-context';

import { LgpdWorkQueue } from './lgpd-work-queue';

export const dynamic = 'force-dynamic';

export default async function LgpdOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ solicitacao?: string }>;
}) {
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
          crumbs={[
            { label: 'Conformidade e segurança', href: '/configuracoes/seguranca' },
            { label: 'Solicitações LGPD' },
          ]}
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
  const [requests, employees, params] = await Promise.all([
    listLgpdRequests(clinicId),
    listEmployees(clinicId),
    searchParams,
  ]);
  const managers = employees.filter(
    (employee) =>
      employee.ativo &&
      !employee.pending &&
      (employee.role === 'owner' || employee.role === 'gestor'),
  );
  const names = new Map(employees.map((employee) => [employee.id, employee.nome]));

  // O histórico é detalhe operacional: a fila inicial não dispara uma query por
  // solicitação. O ID só é aceito se veio da lista tenant-scoped acima.
  const selectedRequest = params.solicitacao
    ? (requests.find((request) => request.id === params.solicitacao) ?? null)
    : null;
  const history = selectedRequest ? await listLgpdRequestHistory(clinicId, selectedRequest.id) : [];

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Conformidade e segurança', href: '/configuracoes/seguranca' },
          { label: 'Solicitações LGPD' },
        ]}
        title="Solicitações LGPD"
        description="Priorize prazos, atribua responsáveis e registre cada etapa do atendimento ao titular."
      />
      <LgpdWorkQueue
        requests={requests}
        selectedRequest={selectedRequest}
        history={history}
        managers={managers}
        names={names}
      />
    </>
  );
}
