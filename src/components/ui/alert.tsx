import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Alert — DS v2 §alert, recriado em Tailwind. API preservada. */
const alertVariants = cva(
  'grid grid-cols-[auto_1fr] items-start gap-3 rounded-(--r-md) border px-4 py-3.5',
  {
    variants: {
      variant: {
        info: 'border-[color-mix(in_oklch,var(--info-500)_26%,transparent)] bg-info-50 [--alert-ic:var(--info-600)] dark:bg-[color-mix(in_oklch,var(--info-500)_14%,transparent)]',
        success:
          'border-[color-mix(in_oklch,var(--success-500)_26%,transparent)] bg-success-50 [--alert-ic:var(--success-600)] dark:bg-[color-mix(in_oklch,var(--success-500)_14%,transparent)]',
        warning:
          'border-[color-mix(in_oklch,var(--warning-500)_32%,transparent)] bg-warning-50 [--alert-ic:var(--warning-700)] dark:bg-[color-mix(in_oklch,var(--warning-500)_16%,transparent)]',
        danger:
          'border-[color-mix(in_oklch,var(--danger-500)_26%,transparent)] bg-danger-50 [--alert-ic:var(--danger-600)] dark:bg-[color-mix(in_oklch,var(--danger-500)_14%,transparent)]',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

const ICONS: Record<NonNullable<VariantProps<typeof alertVariants>['variant']>, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

type AlertProps = ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    title?: ReactNode;
  };

export function Alert({ className, variant = 'info', title, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? 'info'];
  return (
    <div
      role="alert"
      data-slot="alert"
      data-variant={variant ?? 'info'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-px size-5 shrink-0 text-(--alert-ic)" />
      <div className="min-w-0">
        {title ? <b className="text-(length:--fs-sm) font-semibold">{title}</b> : null}
        {/* div (não <p>) para aceitar children em bloco (ex.: <ul>) */}
        {children ? (
          <div
            className={cn('text-(length:--fs-sm) leading-snug text-fg-muted', title && 'mt-0.5')}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
