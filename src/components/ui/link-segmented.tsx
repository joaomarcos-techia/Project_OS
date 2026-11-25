import Link from 'next/link';

import { cn } from '@/lib/ui/cn';

export type LinkSegment = { label: string; href: string; active: boolean };

/**
 * Filtro segmentado dirigido pela URL (ex.: Ativos / Removidos).
 *
 * `Segmented` é um radiogroup de cliente com `onValueChange`; aqui cada opção é
 * um link, porque o filtro mora nos parâmetros da rota e a página é renderizada
 * no servidor. Sem prefetch: opções de um mesmo filtro não valem um render cada.
 */
export function LinkSegmented({
  items,
  label,
  landmark = false,
  className,
}: {
  items: LinkSegment[];
  /** Nome do grupo para leitores de tela. */
  label: string;
  /** Quando as opções trocam a visão da tela, é navegação: vira `<nav>`. */
  landmark?: boolean;
  className?: string;
}) {
  const Root = landmark ? 'nav' : 'div';
  return (
    <Root
      {...(landmark ? {} : { role: 'group' })}
      aria-label={label}
      data-slot="link-segmented"
      className={cn(
        'inline-flex flex-wrap gap-0.5 rounded-(--btn-radius) border border-border bg-surface-2 p-[3px]',
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'inline-flex h-7 items-center rounded-(--tag-radius) px-2.5 text-(length:--fs-sm) font-medium whitespace-nowrap no-underline transition-colors duration-(--dur-fast)',
            item.active
              ? 'bg-surface text-fg shadow-[0_0_0_1px_var(--border),var(--elev-1)]'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          {item.label}
        </Link>
      ))}
    </Root>
  );
}
