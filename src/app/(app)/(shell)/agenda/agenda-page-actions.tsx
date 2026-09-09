'use client';

import { CalendarOff, FileUp, List, MoreVertical } from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import type { AgendaData } from './data';
import { NewAppointmentDrawer } from './new-appointment-drawer';

/** Ações operacionais da agenda: uma primária e um menu para destinos ocasionais. */
export function AgendaPageActions({ data }: { data: AgendaData }) {
  return (
    <div role="group" aria-label="Ações da agenda" className="flex flex-wrap items-center gap-2">
      <Link href="/agenda/lista-espera" className={buttonVariants({ variant: 'secondary' })}>
        <List aria-hidden="true" className="size-4" />
        Lista de espera
      </Link>
      {data.canManageAvailability ? (
        <Link href="/agenda/ausencias" className={buttonVariants({ variant: 'secondary' })}>
          <CalendarOff aria-hidden="true" className="size-4" />
          Ausências médicas
        </Link>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" aria-label="Mais opções" className="size-(--hit-target) p-0">
            <MoreVertical aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild className="min-h-(--hit-target)">
            <Link href="/agenda/importar">
              <FileUp aria-hidden="true" />
              Importar histórico
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {data.canEditAgenda ? <NewAppointmentDrawer data={data} /> : null}
    </div>
  );
}
