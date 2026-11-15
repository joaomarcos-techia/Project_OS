import { House } from 'lucide-react';

import { MetricStrip } from '@/components/ui/metric-strip';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonCard, SkeletonText } from '@/components/ui/skeleton';
import { cn } from '@/lib/ui/cn';

import styles from './dashboard.module.css';

/**
 * Mesmo cabeçalho, faixas e alturas da tela pronta, para o conteúdo não saltar.
 * O `role="status"` fica fora do `aria-busy`: dentro dele, o leitor de tela pode
 * segurar o anúncio até o fim do carregamento.
 *
 * UX-011: o `<h1>` já é "Dashboard", como na tela pronta; a saudação e a data
 * entram como brilho no lugar delas. "Precisa de você" não tem esqueleto: só
 * existe quando há pendência, e reservar o espaço faria a tela pular quando não há.
 */
export default function Loading() {
  return (
    <>
      <span role="status" className="sr-only">
        Carregando o Dashboard
      </span>
      <div aria-busy="true">
        <PageHeader
          icon={<House aria-hidden="true" />}
          title="Dashboard"
          headline={<SkeletonText className={styles.skTitle} />}
          description={<SkeletonText className={styles.skDate} />}
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
            <SkeletonCard lines={8} className={cn(styles.wide, styles.skRowAgenda)} />
            <SkeletonCard lines={5} className={cn(styles.narrow, styles.skRowAgenda)} />
          </div>
          <div className={styles.row}>
            <SkeletonCard lines={4} className={cn(styles.wide, styles.skRowShift)} />
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
