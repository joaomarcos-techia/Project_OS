import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/ui/cn';

import styles from '../dashboard.module.css';

/**
 * Uma linha de "Precisa de você": ícone no tom do assunto, o que aconteceu, um
 * apoio opcional e a ação. A LINHA INTEIRA é o link — o rótulo à direita só tem
 * cara de botão para dizer o que o clique faz; não é um segundo controle.
 * Os atributos extras (ex.: `data-whatsapp-send-alert`) vão para o link.
 */
export function PendingItem({
  href,
  tone,
  icon,
  title,
  detail,
  cta,
  ...linkProps
}: Omit<ComponentProps<typeof Link>, 'title' | 'children'> & {
  href: string;
  tone: 'warning' | 'info' | 'danger';
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  cta: string;
}) {
  return (
    <li>
      <Link href={href} prefetch={false} className={styles.pending} {...linkProps}>
        <span aria-hidden="true" className={styles.pendingIcon} data-tone={tone}>
          {icon}
        </span>
        <span className={styles.pendingCopy}>
          <b>{title}</b>
          {detail ? <span>{detail}</span> : null}
        </span>
        <span
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), styles.pendingCta)}
        >
          {cta}
        </span>
      </Link>
    </li>
  );
}
