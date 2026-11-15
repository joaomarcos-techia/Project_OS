'use client';

import { CalendarOff, FileUp, List } from 'lucide-react';

import { PageActions, type PageActionLink } from '@/components/ui/page-actions';

import type { AgendaData } from './data';
import { NewAppointmentDrawer } from './new-appointment-drawer';

/**
 * Ações operacionais da agenda: uma primária e um menu para destinos ocasionais.
 * UX-012: abaixo de 1024 px, "Lista de espera" e "Ausências médicas" entram no
 * menu "Mais ações" (eram três linhas de botões a 375 px e duas a 768 px, medido
 * em 15/11); no computador, nada muda.
 */
export function AgendaPageActions({ data }: { data: AgendaData }) {
  const secondary: PageActionLink[] = [
    {
      href: '/agenda/lista-espera',
      label: 'Lista de espera',
      icon: <List aria-hidden="true" className="size-4" />,
    },
    ...(data.canManageAvailability
      ? [
          {
            href: '/agenda/ausencias',
            label: 'Ausências médicas',
            icon: <CalendarOff aria-hidden="true" className="size-4" />,
          },
        ]
      : []),
  ];
  return (
    <PageActions
      label="Ações da agenda"
      dobraAbaixoDe="lg"
      secondary={secondary}
      overflow={[
        {
          href: '/agenda/importar',
          label: 'Importar histórico',
          icon: <FileUp aria-hidden="true" />,
        },
      ]}
      primary={data.canEditAgenda ? <NewAppointmentDrawer data={data} /> : null}
    />
  );
}
