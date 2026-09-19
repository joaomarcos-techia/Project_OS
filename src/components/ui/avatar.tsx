import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';

/**
 * Iniciais a partir do nome — primeira e última palavra.
 *
 * Nomes brasileiros carregam preposições ("Maria da Silva"): pegar as duas
 * PRIMEIRAS palavras produziria "MD". Ignorar partículas e usar primeira+última
 * dá "MS", que é o que a pessoa reconhece.
 */
export function initialsFrom(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/u)
    // O split de string vazia devolve [''], que passaria pelo filtro de
    // partícula e produziria iniciais vazias em vez do fallback.
    .filter((p) => p.length > 0)
    .filter((p) => p.length > 2 || !/^(d[aeio]s?|e|von|van)$/iu.test(p));
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Avatar de iniciais — o sistema não guarda foto de paciente, então a
 * referência (que usa retratos) é atendida com a inicial em disco tonal.
 */
export function Avatar({
  name,
  size = 'md',
  className,
  ...props
}: ComponentProps<'span'> & { name: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      data-slot="avatar"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-(--primary-soft) font-semibold text-(--primary-active) dark:text-fg',
        size === 'sm' && 'size-7 text-(length:--fs-2xs)',
        size === 'md' && 'size-8 text-(length:--fs-xs)',
        size === 'lg' && 'size-9 text-(length:--fs-sm)',
        className,
      )}
      {...props}
    >
      {initialsFrom(name)}
    </span>
  );
}
