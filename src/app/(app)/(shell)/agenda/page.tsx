import type { Metadata } from 'next';
/**
 * /agenda — visões Mês / Semana / Dia (item 12). Navegação por URL
 * (`?view=&date=`); o servidor resolve a faixa (range.ts) e busca os
 * atendimentos. "Novo atendimento" segue o fluxo walk-in do C6.
 */
import { Calendar } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PageNoAccess } from '@/components/shared/page-no-access';

import {
  AgendaCalendar,
  AgendaControls,
  agendaPeriodLabel,
  AgendaSummary,
} from './agenda-calendar';
import { AgendaPageActions } from './agenda-page-actions';
import { getAgendaData } from './data';
import { DeliveryFailureStrip } from './delivery-failure-strip';
// P3.3/P5.2 (24/11): convênios de hoje com as pendências pré-consulta (bloco do TISS, só leitura).
import { AgendaInsuranceStrip } from '../convenios/_lib/agenda-insurance-strip';
import { isAgendaView } from './range';

export const metadata: Metadata = { title: 'Agenda' };

export const dynamic = 'force-dynamic';

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
        icon={<Calendar aria-hidden="true" />}
        title="Agenda"
        headline={agendaPeriodLabel(data)}
        description={`${data.appointments.length} atendimento${data.appointments.length === 1 ? '' : 's'} no período`}
        actions={<AgendaPageActions data={data} />}
        controls={<AgendaControls data={data} />}
      />

      <AgendaSummary data={data} />
      <div className="qoro-page-content mt-4">
        {/* EC-32 — em todas as visões: o sinal de uma consulta de outro dia
            vence antes de alguém abrir aquele dia. */}
        <DeliveryFailureStrip
          failures={data.deliveryFailures}
          limited={data.deliveryFailuresLimited}
          tz={data.tz}
          canCopyLink={data.canEditAgenda}
        />
        {/* P3.3/P5.2: some para quem não vê Convênios ou sem convênio no dia. */}
        <AgendaInsuranceStrip />
        <AgendaCalendar data={data} />
      </div>
    </>
  );
}
