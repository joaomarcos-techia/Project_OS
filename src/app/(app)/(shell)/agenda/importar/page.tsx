import type { Metadata } from 'next';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { AuthError, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';

import { HistoryImporter } from './history-importer';

export const metadata: Metadata = { title: 'Importar histórico da agenda' };

export const dynamic = 'force-dynamic';

export default async function ImportAppointmentHistoryPage() {
  await requireUser();
  // A rota pode ser aberta diretamente mesmo quando a ação crítica continua
  // bloqueada. Exibir a negativa evita transformar RBAC esperado em erro 500.
  try {
    await requireFreshPermission(PERMISSIONS.IMPORT_AGENDA);
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== 'forbidden') throw error;
    return (
      <>
        <PageHeader
          crumbs={[{ label: 'Agenda', href: '/agenda' }, { label: 'Importar histórico' }]}
          title="Importar histórico da agenda"
        />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para importar histórico da agenda.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Agenda', href: '/agenda' }, { label: 'Importar histórico' }]}
        title="Importar histórico da agenda"
        description="Fluxo auditado para dados legados. Nenhum item altera a origem dos agendamentos comuns."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="p-(--card-pad)">
          <HistoryImporter />
        </Card>
        <Alert title="Formato do arquivo">
          <p className="text-pretty">
            Envie uma lista JSON com doctorId, patientId, procedureId, scheduledAt e
            historicalStatus. O estado deve ser atendido, cancelado ou faltou; datas futuras são
            rejeitadas.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-(--r-sm) bg-surface-inset p-3 text-xs">
            {`[{\n  "doctorId": "uuid",\n  "patientId": "uuid",\n  "procedureId": "uuid",\n  "scheduledAt": "2025-07-24T10:00:00-03:00",\n  "historicalStatus": "atendido",\n  "externalReference": "LEG-001"\n}]`}
          </pre>
        </Alert>
      </div>
    </>
  );
}
