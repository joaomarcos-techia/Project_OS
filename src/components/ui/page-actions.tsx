'use client';

import { MoreVertical } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/ui/cn';

/** Destino de navegação do cabeçalho. Quem monta a lista já aplicou a permissão. */
export interface PageActionLink {
  href: string;
  label: string;
  icon?: ReactNode;
  /** Repassado ao `next/link`; omitido, vale o padrão do Next. */
  prefetch?: boolean;
}

function linkProps(action: PageActionLink) {
  return {
    href: action.href,
    ...(action.prefetch === undefined ? {} : { prefetch: action.prefetch }),
  };
}

/**
 * UX-012 — ações do cabeçalho numa linha só no celular.
 *
 * A partir de 768 px (`md`), as `secondary` aparecem como botões, como antes.
 * Abaixo disso ficam à vista só a ação principal (`primary`) e o menu "Mais
 * ações", que lista as mesmas secundárias, com o mesmo destino. `overflow` vive
 * sempre no menu (destino ocasional). Nada some: muda de lugar no celular.
 *
 * Só navegação entra no menu. Ação com efeito (salvar, cobrar, excluir) é
 * `primary` ou fica fora deste componente, à vista, para não se misturar com
 * um "ir para".
 */
export function PageActions({
  label,
  secondary = [],
  overflow = [],
  primary,
}: {
  /** Nome do grupo para o leitor de tela, ex.: "Ações da agenda". */
  label: string;
  secondary?: PageActionLink[];
  overflow?: PageActionLink[];
  primary?: ReactNode;
}) {
  const temMenu = secondary.length > 0 || overflow.length > 0;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {secondary.map((action) => (
        <Link
          key={action.href}
          {...linkProps(action)}
          className={cn(buttonVariants({ variant: 'secondary' }), 'max-md:hidden')}
        >
          {action.icon}
          {action.label}
        </Link>
      ))}
      {temMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Sem destino ocasional, no computador o menu só repetiria os
                botões ao lado: some a partir de 768 px. */}
            <Button
              variant="ghost"
              aria-label="Mais ações"
              className={cn('size-(--hit-target) p-0', overflow.length === 0 && 'md:hidden')}
            >
              <MoreVertical aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {secondary.map((action) => (
              <DropdownMenuItem
                key={action.href}
                asChild
                className="min-h-(--hit-target) md:hidden"
              >
                <Link {...linkProps(action)}>
                  {action.icon}
                  {action.label}
                </Link>
              </DropdownMenuItem>
            ))}
            {overflow.map((action) => (
              <DropdownMenuItem key={action.href} asChild className="min-h-(--hit-target)">
                <Link {...linkProps(action)}>
                  {action.icon}
                  {action.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {primary}
    </div>
  );
}
