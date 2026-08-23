import type { ComponentProps, ReactNode } from 'react';

import { Search } from 'lucide-react';

import { cn } from '@/lib/ui/cn';

import { fieldControlClassName } from './input';

/**
 * Barra de filtros de página — busca à esquerda, controles à direita.
 *
 * Diferente do `TableToolbar`, que vive DENTRO da moldura da tabela: esta fica
 * acima dela, no nível da página, e é o que a referência usa nas telas de
 * listagem. As duas coexistem porque resolvem escopos diferentes; usar a toolbar
 * como filtro de página foi o que produziu barras distintas em cada rota.
 */
export function FilterBar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="filter-bar"
      className={cn('mb-(--sp-4) flex flex-wrap items-center gap-(--sp-2)', className)}
      {...props}
    />
  );
}

/** Empurra o que vem depois para a direita. */
export function FilterBarSpacer() {
  return <span className="ml-auto" aria-hidden="true" />;
}

/**
 * Campo de busca com ícone. `grow` faz dele o elemento elástico da barra, como
 * na referência — os selects mantêm largura natural e a busca absorve o resto.
 */
export function SearchField({
  className,
  grow = true,
  ...props
}: ComponentProps<'input'> & { grow?: boolean }) {
  return (
    <span className={cn('relative block', grow ? 'min-w-60 flex-1' : 'w-60', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
      />
      <input type="search" className={cn(fieldControlClassName, 'pl-9')} {...props} />
    </span>
  );
}

/** Rótulo de contexto dentro da barra (ex.: contagem do filtro aplicado). */
export function FilterBarNote({ children }: { children: ReactNode }) {
  return <span className="text-(length:--fs-body-sm) text-fg-subtle">{children}</span>;
}
