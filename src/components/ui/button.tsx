import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/ui/cn';
import { Spinner } from './spinner';

/**
 * Botão — classes do Design System (`ds.css` `.btn`). Mantém o CVA (tipos
 * `buttonVariants`/`VariantProps` consumidos por outras telas), só troca as
 * classes Tailwind pelas do DS. `buttonVariants(...)` serve para estilizar um
 * <Link> como botão.
 */
export const buttonVariants = cva('btn', {
  variants: {
    variant: {
      primary: '',
      secondary: 'secondary',
      ghost: 'ghost',
      danger: 'danger',
      success: 'success',
    },
    size: { sm: 'sm', md: '', lg: 'lg' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

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
