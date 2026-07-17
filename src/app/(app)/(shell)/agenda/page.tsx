/**
 * /agenda — v1 walk-in: lista os atendimentos de hoje + "Novo atendimento" em
 * Drawer (default: agendar). O calendário completo é evolução futura sobre o
 * mesmo backend C6 (createAppointment/slots).
 */
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { AppointmentStatusBadge } from '@/components/ui/status-badge';

import { getAgendaData } from './data';
import { NewAppointmentDrawer } from './new-appointment-drawer';

export const dynamic = 'force-dynamic';

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default async function AgendaPage() {
  const data = await getAgendaData();

  if (!data.hasClinic) {
    return (
      <>
        <PageHeader title="Agenda" />
        <EmptyState title="Sem clínica" description="Sua conta não está vinculada a uma clínica." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Agenda' }]}
        title="Agenda"
        description="Atendimentos de hoje. Crie um atendimento quando o paciente chegar na clínica."
        actions={<NewAppointmentDrawer data={data} />}
      />

      {data.appointments.length === 0 ? (
        <EmptyState
          title="Nenhum atendimento hoje"
          description="Clique em “Novo atendimento” quando um paciente chegar ou para agendar."
        />
      ) : (
        <Card>
          <ul className="flex flex-col">
            {data.appointments.map((a) => {
              const noConsultorio = a.status === 'chegou' || a.status === 'em_atendimento';
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border px-(--card-pad) py-3 last:border-b-0"
                >
                  <span className="font-mono text-sm">{hora(a.horario)}</span>
                  <span className="min-w-0 truncate font-medium">{a.pacienteNome}</span>
                  <span className="text-xs text-fg-subtle">{a.medicoNome}</span>
                  <AppointmentStatusBadge status={a.status} />
                  <span className="flex-1" />
                  {noConsultorio ? (
                    <Link
                      href="/consultorio"
                      className="text-(length:--fs-sm) font-medium text-link hover:underline"
                    >
                      Abrir no Consultório
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
