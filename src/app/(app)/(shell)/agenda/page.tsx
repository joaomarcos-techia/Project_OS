/**
 * /agenda — visões Mês / Semana / Dia (item 12). Navegação por URL
 * (`?view=&date=`); o servidor resolve a faixa (range.ts) e busca os
 * atendimentos. "Novo atendimento" segue o fluxo walk-in do C6.
 */
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';

import { AgendaCalendar, AgendaNav } from './agenda-calendar';
import { getAgendaData } from './data';
import { NewAppointmentDrawer } from './new-appointment-drawer';
import { isAgendaView } from './range';

export const dynamic = 'force-dynamic';

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const view = isAgendaView(sp.view) ? sp.view : 'day';
  const data = await getAgendaData({ view, ...(sp.date ? { date: sp.date } : {}) });

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
        description="Veja os atendimentos por mês, semana ou dia."
        actions={
          <>
            <Link
              href="/agenda/importar"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Importar historico
            </Link>
            <Link
              href="/agenda/lista-espera"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Lista de espera
            </Link>
            {data.canManageAvailability ? (
              <Link
                href="/agenda/ausencias"
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                Ausencias medicas
              </Link>
            ) : null}
            {data.canEditAgenda ? <NewAppointmentDrawer data={data} /> : null}
          </>
        }
      />

      <AgendaNav data={data} />
      <AgendaCalendar data={data} />
    </>
  );
}
