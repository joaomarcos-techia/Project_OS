import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Alert — DS §08.9. Info / Success / Warning / Danger com ícone. */
const alertVariants = cva(
  'flex gap-3 rounded-lg border p-3.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        info: 'border-info-100 bg-info-50 text-info-700 dark:border-transparent dark:bg-info-500/15 dark:text-info-100 [&>svg]:text-info-600',
        success:
          'border-success-100 bg-success-50 text-success-700 dark:border-transparent dark:bg-success-500/15 dark:text-success-100 [&>svg]:text-success-600',
        warning:
          'border-warning-100 bg-warning-50 text-warning-700 dark:border-transparent dark:bg-warning-500/15 dark:text-warning-100 [&>svg]:text-warning-600',
        danger:
          'border-danger-100 bg-danger-50 text-danger-700 dark:border-transparent dark:bg-danger-500/15 dark:text-danger-100 [&>svg]:text-danger-600',
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
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon />
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
