/**
 * /agenda — v1 walk-in: lista os atendimentos de hoje + botão "Novo atendimento"
 * (encaixe). O calendário completo (criar/agendar por horário) é evolução futura
 * sobre o mesmo backend C6 (createAppointment/slots).
 */
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

import { AgendaView } from './agenda-view';
import { getAgendaData } from './data';

export const dynamic = 'force-dynamic';

export default async function AgendaPage() {
  const data = await getAgendaData();

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Operação' }, { label: 'Agenda' }]}
        title="Agenda"
        description="Atendimentos de hoje. Crie um atendimento quando o paciente chegar na clínica."
      />
      {data.hasClinic ? (
        <AgendaView data={data} />
      ) : (
        <EmptyState title="Sem clínica" description="Sua conta não está vinculada a uma clínica." />
      )}
    </>
  );
}
