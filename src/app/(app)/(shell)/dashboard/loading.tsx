import { House } from 'lucide-react';

import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { cn } from '@/lib/ui/cn';

import styles from './dashboard.module.css';

/**
 * Mesmo cabeçalho, faixas e alturas da tela pronta, para o conteúdo não saltar.
 * O `role="status"` fica fora do `aria-busy`: dentro dele, o leitor de tela pode
 * segurar o anúncio até o fim do carregamento.
 */
export default function Loading() {
  return (
    <>
      <span role="status" className="sr-only">
        Carregando o Dashboard
      </span>
      <div aria-busy="true">
        <PageHeader
          crumbs={[
            {
              label: (
                <>
                  <House aria-hidden="true" />
                  Dashboard
                </>
              ),
            },
          ]}
          title={
            <>
              <span className="sr-only">Dashboard</span>
              <Skeleton className={styles.skTitle} />
            </>
          }
          meta={<Skeleton className={styles.skDate} />}
          actions={
            <>
              <Skeleton className={styles.skAction} />
              <Skeleton className={styles.skAction} />
            </>
          }
        />
        <div className={styles.body}>
          <MetricStrip variant="joined" aria-hidden="true" className={styles.kpis}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} data-slot="stat-card" className={styles.skCell}>
                <Skeleton className={styles.skLabel} />
                <Skeleton className={styles.skValue} />
                <Skeleton className={styles.skHint} />
              </div>
            ))}
          </MetricStrip>
          <div className={styles.row}>
            <SkeletonCard lines={4} className={cn(styles.narrow, styles.skRowShift)} />
            <SkeletonCard lines={4} className={cn(styles.wide, styles.skRowShift)} />
          </div>
          <div className={styles.row}>
            <SkeletonCard lines={8} className={cn(styles.wide, styles.skRowAgenda)} />
            <SkeletonCard lines={5} className={cn(styles.narrow, styles.skRowAgenda)} />
          </div>
          <div className={styles.row}>
            <SkeletonCard lines={6} className={cn(styles.wide, styles.skRowHistory)} />
            <SkeletonCard lines={6} className={cn(styles.narrow, styles.skRowHistory)} />
          </div>
        </div>
      </div>
    </>
  );
}
