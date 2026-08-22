/**
 * /agenda — visões Mês / Semana / Dia (item 12). Navegação por URL
 * (`?view=&date=`); o servidor resolve a faixa (range.ts) e busca os
 * atendimentos. "Novo atendimento" segue o fluxo walk-in do C6.
 */
import { EmptyState } from '@/components/ui/empty-state';
import { NavTabs } from '@/components/ui/nav-tabs';
import { PageHeader } from '@/components/ui/page-header';
import { PageNoAccess } from '@/components/shared/page-no-access';

import { AgendaCalendar, AgendaNav } from './agenda-calendar';
import { AgendaPageActions } from './agenda-page-actions';
import { getAgendaData } from './data';
import { isAgendaView } from './range';

export const dynamic = 'force-dynamic';

const AGENDA_TABS = [
  { label: 'Agenda', href: '/agenda', exact: true },
  { label: 'Lista de espera', href: '/agenda/lista-espera' },
];

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const view = isAgendaView(sp.view) ? sp.view : 'day';
  const data = await getAgendaData({ view, ...(sp.date ? { date: sp.date } : {}) });

  // AUTHZ-002 — o loader já saiu sem consultar nada; aqui só desenhamos a
  // negativa. A ordem importa: `hasAccess` antes de `hasClinic` porque quem
  // não pode ver a agenda não deve nem saber se a clínica está vinculada.
  if (!data.hasAccess) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Operação' }, { label: 'Agenda' }]}
        title="Agenda"
        description="Seu perfil não tem permissão para ver a agenda da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }

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
      />

      <NavTabs tabs={AGENDA_TABS} className="mb-(--sp-4)" />
      <AgendaNav data={data} actions={<AgendaPageActions data={data} />} />
      <AgendaCalendar data={data} />
    </>
  );
}
