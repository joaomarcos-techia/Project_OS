import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';

import { HistoryImporter } from './history-importer';

export const dynamic = 'force-dynamic';

export default async function ImportAppointmentHistoryPage() {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.IMPORT_AGENDA);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Agenda', href: '/agenda' }, { label: 'Importar historico' }]}
        title="Importar historico da agenda"
        description="Fluxo auditado para dados legados. Nenhum item altera a origem dos agendamentos comuns."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="p-(--card-pad)">
          <HistoryImporter />
        </Card>
        <Alert title="Formato do arquivo">
          <p className="text-pretty">
            Envie uma lista JSON com doctorId, patientId, procedureId, scheduledAt e
            historicalStatus. O estado deve ser atendido, cancelado ou faltou; datas futuras sao
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
