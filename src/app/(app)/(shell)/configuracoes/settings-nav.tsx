'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/ui/cn';

import type { SettingsNavGroup, SettingsNavItem } from './settings-navigation';

export function isSettingsItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Navegação das configurações — horizontal, em dois níveis, no topo de toda
 * página da seção. Não há barra lateral interna: o Qoro já tem UMA navegação
 * global, e empilhar outra hierarquia permanente ao lado dela transforma "onde
 * eu configuro isso?" em duas perguntas.
 *
 * Nível 1 são as categorias; clicar leva à primeira configuração da categoria.
 * Nível 2 só aparece quando a categoria tem mais de um destino — mostrar uma
 * sub-linha com um item só é ruído. Juntos, os dois níveis alcançam os treze
 * destinos sem esconder nenhum atrás de rolagem.
 *
 * Abaixo de `sm` os dois níveis viram um menu: seis categorias em linha
 * quebrariam em três fileiras e comeriam um terço da tela antes do conteúdo.
 * Só uma das formas existe na árvore de acessibilidade por vez (`display:none`).
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  if (groups.length === 0) return null;

  const activeGroup =
    groups.find((group) => group.items.some((item) => isSettingsItemActive(pathname, item.href))) ??
    groups[0]!;
  const activeItem = activeGroup.items.find((item) => isSettingsItemActive(pathname, item.href));

  return (
    <nav aria-label="Configurações" className="mb-(--sp-5) min-w-0">
      <div className="hidden sm:block">
        <div className="flex max-w-full flex-wrap gap-0.5 border-b border-border">
          {groups.map((group) => {
            const active = group === activeGroup;
            return (
              <Link
                key={group.label}
                href={group.items[0]!.href}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'relative rounded-t-(--r-sm) px-3.5 py-2.5 text-(length:--fs-body-sm) font-medium whitespace-nowrap',
                  'transition-colors duration-(--dur-fast) focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
                  'after:absolute after:right-2 after:-bottom-px after:left-2 after:h-0.5 after:bg-primary after:transition-opacity',
                  active
                    ? 'text-primary after:opacity-100'
                    : 'text-fg-muted after:opacity-0 hover:text-fg',
                )}
              >
                {group.label}
              </Link>
            );
          })}
        </div>

        {activeGroup.items.length > 1 ? (
          <div className="mt-(--sp-3) flex flex-wrap gap-x-(--sp-4) gap-y-1.5 px-1">
            {activeGroup.items.map((item) => (
              <SubItem key={item.href} item={item} active={item === activeItem} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="subtle" size="sm" className="w-full justify-between">
              {activeItem?.label ?? activeGroup.label}
              <ChevronDown aria-hidden="true" className="size-4 text-fg-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[70vh] w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
          >
            {groups.map((group) => (
              <div key={group.label}>
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {group.items.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      aria-current={item === activeItem ? 'page' : undefined}
                      className={cn(item === activeItem && 'font-medium text-fg')}
                    >
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}

/**
 * Item do segundo nível. Ativo por contraste e peso, sem preenchimento: é a
 * mesma regra da navegação principal, e a pílula azul que existia aqui gritava
 * mais alto que o menu que a contém.
 */
function SubItem({ item, active }: { item: SettingsNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-(--r-sm) py-0.5 text-(length:--fs-body-sm) whitespace-nowrap',
        'transition-colors duration-(--dur-fast) focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
        active ? 'font-medium text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      {item.label}
    </Link>
  );
}
