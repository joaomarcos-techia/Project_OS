import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/ui/cn';

/** Alert — classes do Design System (`ds.css` `.alert` + `.al-ico`). CVA preservado. */
const alertVariants = cva('alert', {
  variants: {
    variant: { info: 'info', success: 'success', warning: 'warning', danger: 'danger' },
  },
  defaultVariants: { variant: 'info' },
});

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
      <span className="al-ico">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        {title ? <b>{title}</b> : null}
        {/* div (não <p>) para aceitar children em bloco (ex.: <ul>); estilo igual a `.alert p` */}
        {children ? (
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-2)',
              lineHeight: 1.45,
              marginTop: title ? 2 : 0,
            }}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
