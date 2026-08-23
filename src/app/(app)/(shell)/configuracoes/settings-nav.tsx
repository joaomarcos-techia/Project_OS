'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId } from 'react';

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
 * Navegação das configurações — o diretório completo, no topo de toda página da
 * seção. É ela que faz o papel de hub.
 *
 * Todos os treze destinos ficam visíveis o tempo todo, agrupados por categoria.
 * Isto é deliberado e custa altura: a versão anterior mostrava só as seis
 * categorias e revelava os itens de uma por vez, e o efeito prático foi
 * configurações sumirem da tela — na página inicial da seção (Perfil), a
 * categoria Clínica tem um item só, então não havia nada abaixo das categorias.
 * Descoberta rápida vem antes de economia de pixel numa tela de ajustes.
 *
 * Horizontal, e não uma coluna: o Qoro já tem UMA navegação lateral, e empilhar
 * outra hierarquia permanente ao lado dela transforma "onde eu configuro isso?"
 * em duas perguntas.
 *
 * Abaixo de `sm` o diretório vira menu — seis colunas viram seis fileiras e
 * comeriam a tela inteira antes do conteúdo. Só uma das formas existe na árvore
 * de acessibilidade por vez (`display:none` remove a outra).
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  const uid = useId();
  if (groups.length === 0) return null;

  const activeItem = groups
    .flatMap((group) => group.items)
    .find((item) => isSettingsItemActive(pathname, item.href));

  return (
    <nav aria-label="Configurações" className="mb-(--sp-5) min-w-0">
      {/* Colunas fixas, nao `auto-fit`: com largura minima o navegador cabia
          cinco colunas em 1440px e jogava a sexta categoria sozinha para uma
          segunda fileira, com um vazio do lado. 3 ou 6 divide os seis grupos
          exatamente, em qualquer largura. */}
      <div className="hidden gap-x-(--sp-5) gap-y-(--sp-4) border-b border-border pb-(--sp-4) sm:grid sm:grid-cols-3 xl:grid-cols-6">
        {groups.map((group, index) => {
          // Rótulo de grupo como texto + `aria-labelledby`, não <h2>: a barra
          // vem ANTES do <h1> da página, e seis h2 aqui inverteriam o esqueleto
          // de títulos que o leitor de tela usa para navegar.
          const labelId = `${uid}-${index}`;
          return (
            <div key={group.label} className="min-w-0">
              <p
                id={labelId}
                className="mb-1.5 text-(length:--fs-2xs) font-medium tracking-(--tracking-label) text-fg-subtle uppercase"
              >
                {group.label}
              </p>
              <ul aria-labelledby={labelId} className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item.href} className="min-w-0">
                    <NavItem item={item} active={item === activeItem} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="subtle" size="sm" className="w-full justify-between">
              {activeItem?.label ?? 'Configurações'}
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
 * Ativo por contraste e peso, sem preenchimento — mesma regra da navegação
 * principal. A pílula azul que existia aqui gritava mais alto que o menu que a
 * contém.
 */
function NavItem({ item, active }: { item: SettingsNavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'block truncate rounded-(--r-sm) text-(length:--fs-body-sm)',
        'transition-colors duration-(--dur-fast) focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
        active ? 'font-medium text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      {item.label}
    </Link>
  );
}
