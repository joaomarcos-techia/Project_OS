import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';
import { Spinner } from './spinner';

/**
 * Botão — DS v2 (design_system/DSv2.html §btn) recriado em Tailwind.
 * `secondary` (= visual default do DS) e `success` não existem no DS v2;
 * permanecem como variantes de compatibilidade com as telas existentes.
 * `buttonVariants(...)` serve para estilizar um <Link> como botão.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-1.75 whitespace-nowrap',
    'h-(--control-h) rounded-(--btn-radius) border px-(--control-px) text-(length:--control-fs) font-medium',
    'transition-all duration-(--dur-fast) ease-out',
    'focus-visible:shadow-(--focus-ring) focus-visible:outline-none',
    'active:translate-y-[0.5px]',
    'disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-primary text-on-primary shadow-[0_1px_2px_oklch(0.4_0.1_205/0.25),inset_0_1px_0_oklch(1_0_0/0.12)] hover:bg-(--primary-hover) active:bg-(--primary-active)',
        secondary: 'border-(--field-border) bg-surface text-fg shadow-xs hover:bg-surface-hover',
        subtle: 'border-border bg-surface text-fg shadow-none hover:bg-surface-hover',
        soft: 'border-transparent bg-(--primary-soft) text-(--primary-active) shadow-none hover:bg-[color-mix(in_oklch,var(--primary)_16%,var(--surface))] dark:text-fg',
        ghost:
          'border-transparent bg-transparent text-fg-muted shadow-none hover:bg-surface-hover hover:text-fg',
        accent:
          'border-transparent bg-accent text-on-accent shadow-[0_1px_2px_oklch(0.5_0.12_45/0.25),inset_0_1px_0_oklch(1_0_0/0.14)] hover:brightness-105',
        danger:
          'border-transparent bg-danger-600 text-[oklch(0.99_0.01_27)] shadow-[0_1px_2px_oklch(0.5_0.2_27/0.25),inset_0_1px_0_oklch(1_0_0/0.12)] hover:bg-danger-700',
        success:
          'border-transparent bg-success-600 text-[oklch(0.99_0.01_152)] shadow-[0_1px_2px_oklch(0.5_0.1_151/0.25),inset_0_1px_0_oklch(1_0_0/0.12)] hover:bg-success-700',
      },
      size: {
        sm: 'h-(--control-h-sm) gap-1.25 px-2.5 text-(length:--fs-xs)',
        md: '',
        lg: 'h-(--control-h-lg) px-5 text-(length:--fs-base)',
      },
      icon: {
        true: 'w-(--control-h) px-0',
        false: '',
      },
    },
    compoundVariants: [{ icon: true, size: 'sm', className: 'w-(--control-h-sm)' }],
    defaultVariants: { variant: 'primary', size: 'md', icon: false },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  icon,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, icon }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
