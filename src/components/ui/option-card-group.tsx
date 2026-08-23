'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId } from 'react';

import { cn } from '@/lib/ui/cn';

export type OptionCard<V extends string> = {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
};

/**
 * Escolha entre poucas opções descritas — os cards de tipo de documento da
 * referência.
 *
 * Difere do `Select` de propósito: aqui cada opção carrega uma DESCRIÇÃO, e
 * `<option>` não comporta duas linhas. Só vale para conjunto fixo e pequeno; em
 * lista dinâmica (procedimentos, profissionais) o select continua certo.
 *
 * `<input type="radio">` de verdade sob o card: teclado, `name`, submit de
 * formulário e leitor de tela funcionam sem reimplementação.
 */
export function OptionCardGroup<V extends string>({
  name,
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
  className,
}: {
  name: string;
  value: V;
  onValueChange: (value: V) => void;
  options: OptionCard<V>[];
  'aria-label'?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="option-card-group"
      className={cn('flex flex-col gap-1.5', className)}
    >
      {options.map((option) => {
        const inputId = `${id}-${option.value}`;
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            htmlFor={inputId}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-(--r-md) border p-3 transition-colors duration-(--dur-fast)',
              'has-[:focus-visible]:shadow-(--focus-ring)',
              selected
                ? 'border-primary bg-(--primary-soft)'
                : 'border-border hover:bg-surface-hover',
            )}
          >
            <input
              id={inputId}
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.icon ? (
              <span
                aria-hidden="true"
                className={cn(
                  'mt-px shrink-0 [&>svg]:size-4',
                  selected ? 'text-primary' : 'text-fg-subtle',
                )}
              >
                {option.icon}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  'text-(length:--fs-sm) font-medium',
                  selected ? 'text-(--primary-active) dark:text-fg' : 'text-fg',
                )}
              >
                {option.label}
              </span>
              {option.description ? (
                <span className="text-(length:--fs-xs) leading-snug text-fg-muted">
                  {option.description}
                </span>
              ) : null}
            </span>
            {selected ? (
              <Check aria-hidden="true" className="ml-auto mt-px size-4 shrink-0 text-primary" />
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
