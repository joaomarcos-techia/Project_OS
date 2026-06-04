import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';
import { Spinner } from './spinner';

/**
 * Botão — DS §08.9 (foundation). Variantes/tamanhos fiéis ao `.btn` do Design System.
 * Use `buttonVariants(...)` para estilizar um <Link> como botão sem dependência de Slot.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium leading-none tracking-[-0.01em] shadow-xs ' +
    'transition-[background-color,box-shadow,transform,border-color] duration-[120ms] ease-out ' +
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 ' +
    'active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-primary-600 text-on-primary hover:bg-primary-700',
        secondary: 'border-border-strong bg-surface text-fg hover:bg-surface-inset',
        ghost: 'border-transparent bg-transparent text-fg-muted shadow-none hover:bg-surface-inset hover:text-fg',
        danger: 'border-transparent bg-danger-600 text-white hover:bg-danger-700',
        success: 'border-transparent bg-success-600 text-white hover:bg-success-700',
      },
      size: {
        sm: 'px-3 py-[7px] text-[13px]',
        md: 'px-4 py-2.5',
        lg: 'px-[22px] py-[13px] text-[15px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
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
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
