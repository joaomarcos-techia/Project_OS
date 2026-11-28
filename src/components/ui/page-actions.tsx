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

/**
 * Classes literais por ponto de dobra (o Tailwind só gera o que aparece escrito).
 * `md` = 768 px; `lg` = 1024 px, para cabeçalhos que ainda quebram em tablet.
 */
const DOBRA = {
  md: { botao: 'max-md:hidden', item: 'md:hidden', gatilho: 'md:hidden' },
  lg: { botao: 'max-lg:hidden', item: 'lg:hidden', gatilho: 'lg:hidden' },
} as const;

function linkProps(action: PageActionLink) {
  return {
    href: action.href,
    ...(action.prefetch === undefined ? {} : { prefetch: action.prefetch }),
  };
}

/**
 * UX-012 — ações do cabeçalho numa linha só no celular.
 *
 * A partir do ponto de dobra (`dobraAbaixoDe`, 768 px por padrão), as
 * `secondary` aparecem como botões, como antes. Abaixo dele ficam à vista só a
 * ação principal (`primary`) e o menu "Mais ações", que lista as mesmas
 * secundárias, com o mesmo destino. `overflow` vive sempre no menu (destino
 * ocasional). Nada some: muda de lugar em tela estreita.
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
  dobraAbaixoDe = 'md',
}: {
  /** Nome do grupo para o leitor de tela, ex.: "Ações da agenda". */
  label: string;
  secondary?: PageActionLink[];
  overflow?: PageActionLink[];
  primary?: ReactNode;
  /** Largura abaixo da qual as secundárias entram no menu. */
  dobraAbaixoDe?: keyof typeof DOBRA;
}) {
  const temMenu = secondary.length > 0 || overflow.length > 0;
  const dobra = DOBRA[dobraAbaixoDe];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {secondary.map((action) => (
        <Link
          key={action.href}
          {...linkProps(action)}
          className={cn(buttonVariants({ variant: 'secondary' }), dobra.botao)}
        >
          {action.icon}
          {action.label}
        </Link>
      ))}
      {temMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Sem destino ocasional, em tela larga o menu só repetiria os
                botões ao lado: some a partir do ponto de dobra. */}
            <Button
              variant="ghost"
              aria-label="Mais ações"
              className={cn('size-(--hit-target) p-0', overflow.length === 0 && dobra.gatilho)}
            >
              <MoreVertical aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* Folga da borda: no celular o menu encostava na lateral da tela. */}
          <DropdownMenuContent align="end" collisionPadding={8}>
            {secondary.map((action) => (
              <DropdownMenuItem
                key={action.href}
                asChild
                className={cn('min-h-(--hit-target)', dobra.item)}
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
