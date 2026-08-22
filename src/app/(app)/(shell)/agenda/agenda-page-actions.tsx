'use client';

import { CalendarOff, ChevronDown, FileUp } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="min-h-(--hit-target)">
            Mais opções
            <ChevronDown aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild className="min-h-(--hit-target)">
            <Link href="/agenda/importar">
              <FileUp aria-hidden="true" />
              Importar histórico
            </Link>
          </DropdownMenuItem>
          {data.canManageAvailability ? (
            <DropdownMenuItem asChild className="min-h-(--hit-target)">
              <Link href="/agenda/ausencias">
                <CalendarOff aria-hidden="true" />
                Ausências médicas
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {data.canEditAgenda ? <NewAppointmentDrawer data={data} /> : null}
    </div>
  );
}
