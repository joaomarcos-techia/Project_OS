import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/ui/cn';

const HEADINGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

/** Painel do dashboard — Card DS v2 com cabeçalho compacto + ação opcional. */
export function PanelCard({
  title,
  titleIcon,
  action,
  meta,
  regionLabel,
  headingLevel = 4,
  count,
  description,
  aside,
  flush = false,
  children,
  className,
}: {
  title: ReactNode;
  titleIcon?: ReactNode;
  /** Link de ação no canto (ex.: "Financeiro"). */
  action?: { label: string; href: string };
  /** Nota discreta no canto (ex.: "em breve"). */
  meta?: ReactNode;
  /**
   * Nível do título. O padrão segue `h4` (o /admin e as telas antigas); no
   * dashboard v5 os cartões são `h2`, logo abaixo do `h1` da página.
   */
  headingLevel?: 2 | 3 | 4;
  /**
   * Contagem ao lado do título ("Próximos na agenda 4"). É IRMÃ do título, não
   * filha: o texto do título continua exato para quem o procura.
   */
  count?: ReactNode;
  /** Linha de apoio sob o título (ex.: período e total de um gráfico). */
  description?: ReactNode;
  /** Conteúdo livre no canto do cabeçalho; substitui `action`/`meta`. */
  aside?: ReactNode;
  /**
   * Sem padding no corpo: listas e linhas encostam nas bordas do cartão e cada
   * filho cuida do próprio respiro, como no cartão "conteúdo em lista" do v5.
   */
  flush?: boolean;
  /**
   * Transforma o painel em landmark nomeado. O `<h4>` do título dá estrutura de
   * leitura, mas não cria região navegável: sem isto, quem usa leitor de tela
   * não consegue pular direto para o painel.
   *
   * É `string` e não derivado do `title` porque `title` é ReactNode e nem sempre
   * dá para transformar em texto.
   */
  regionLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  const Heading = HEADINGS[headingLevel];
  return (
    <Card
      data-slot="panel-card"
      data-flush={flush ? 'true' : undefined}
      {...(regionLabel ? { role: 'region', 'aria-label': regionLabel } : {})}
      className={cn('flex flex-col', flush ? 'p-0' : 'p-(--sp-4)', className)}
    >
      <div
        data-slot="panel-header"
        className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      >
        <Heading className="flex items-center gap-1.5 text-(length:--fs-sm) font-semibold [&>svg]:size-4 [&>svg]:text-fg-subtle">
          {titleIcon}
          {title}
        </Heading>
        {count !== undefined && count !== null ? (
          <span data-slot="panel-count" className="mr-auto -ml-1">
            {count}
          </span>
        ) : null}
        {aside ? (
          <div data-slot="panel-aside" className="flex items-center gap-2">
            {aside}
          </div>
        ) : action ? (
          <Link
            href={action.href}
            className="text-(length:--fs-xs) font-medium text-link hover:underline"
          >
            {action.label}
          </Link>
        ) : meta ? (
          <span className="text-(length:--fs-2xs) tracking-(--tracking-label) text-fg-subtle uppercase">
            {meta}
          </span>
        ) : null}
        {description ? (
          <p
            data-slot="panel-description"
            className="order-last basis-full text-(length:--fs-sm) text-fg-muted"
          >
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </Card>
  );
}
