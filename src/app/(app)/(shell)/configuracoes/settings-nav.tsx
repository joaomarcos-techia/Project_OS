'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/ui/cn';

import { SETTINGS_NAVIGATION, groupOf } from './settings-navigation';

/**
 * Abas das configurações — uma por categoria, no topo de toda página da seção.
 *
 * Recebe apenas os hrefs que a pessoa pode abrir, e não os grupos inteiros, por
 * uma razão de arquitetura e não de gosto: cada categoria carrega um ícone, que
 * é um COMPONENTE React e não atravessa a fronteira servidor→cliente como prop.
 * O mapa é importado aqui e filtrado localmente; o servidor manda só a lista de
 * strings que decidem o que aparece.
 */
export function SettingsNav({ visibleHrefs }: { visibleHrefs: string[] }) {
  const pathname = usePathname();
  const permitido = new Set(visibleHrefs);

  const groups = SETTINGS_NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => permitido.has(item.href)),
  })).filter((group) => group.items.length > 0);

  if (groups.length === 0) return null;

  // Sem fallback para a primeira aba: `/configuracoes/perfil` chega pelo menu
  // do rodapé e não pertence a categoria nenhuma. Marcar `Agenda` ali seria
  // dizer ao operador que ele está num lugar onde não está.
  const active = groupOf(groups, pathname);

  return (
    <nav aria-label="Configurações" className="mb-(--sp-6) min-w-0">
      <div className="hidden flex-wrap gap-0.5 border-b border-border sm:flex">
        {groups.map((group) => {
          const Icon = group.icon;
          const on = group === active;
          return (
            <Link
              key={group.id}
              href={`/configuracoes/${group.id}`}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'relative inline-flex items-center gap-2 rounded-t-(--r-sm) px-3 py-3 text-(length:--fs-body-sm) font-medium whitespace-nowrap',
                'transition-colors duration-(--dur-fast) focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
                'after:absolute after:right-2.5 after:-bottom-px after:left-2.5 after:h-0.5 after:rounded-t-full after:bg-primary after:transition-opacity',
                on
                  ? 'text-primary after:opacity-100'
                  : 'text-fg-muted after:opacity-0 hover:text-fg',
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {group.label}
            </Link>
          );
        })}
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="subtle" size="sm" className="w-full justify-between">
              {active?.label ?? 'Configurações'}
              <ChevronDown aria-hidden="true" className="size-4 text-fg-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
            {groups.map((group) => {
              const Icon = group.icon;
              return (
                <DropdownMenuItem key={group.id} asChild>
                  <Link
                    href={`/configuracoes/${group.id}`}
                    aria-current={group === active ? 'page' : undefined}
                    className={cn(group === active && 'font-medium text-fg')}
                  >
                    <Icon />
                    {group.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
