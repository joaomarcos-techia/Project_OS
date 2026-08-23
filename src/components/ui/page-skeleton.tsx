import { Skeleton, SkeletonCard, SkeletonTable } from './skeleton';

/**
 * Esqueletos de rota para `loading.tsx` — DS v2 §sk. Uma variante por
 * anatomia de tela; loading.tsx vira one-liner (zero duplicação).
 */
export function PageSkeleton({
  variant = 'table',
}: {
  variant?: 'table' | 'cards' | 'stats-table' | 'stats-cards' | 'board' | 'detail';
}) {
  const header = (
    <div className="mb-(--sp-5) flex flex-col gap-2.5">
      <Skeleton className="h-7 w-56 max-w-full" />
      <Skeleton className="h-3 w-80 max-w-full" />
    </div>
  );

  const statRow = (
    <div className="mb-(--sp-4) grid grid-cols-2 gap-(--sp-4) xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonCard key={i} lines={1} />
      ))}
    </div>
  );

  switch (variant) {
    case 'cards':
      return (
        <div aria-busy="true">
          {header}
          <div className="grid gap-(--sp-4) md:grid-cols-2 xl:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      );
    case 'stats-table':
      return (
        <div aria-busy="true">
          {header}
          {statRow}
          <SkeletonTable rows={6} />
        </div>
      );
    case 'stats-cards':
      return (
        <div aria-busy="true">
          {header}
          {statRow}
          <div className="grid gap-(--sp-4) lg:grid-cols-[3fr_2fr]">
            <SkeletonCard lines={6} />
            <SkeletonCard lines={6} />
          </div>
        </div>
      );
    case 'board':
      return (
        <div aria-busy="true">
          {header}
          <div className="grid gap-(--sp-4) lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, col) => (
              <div key={col} className="flex flex-col gap-(--sp-3)">
                <Skeleton className="h-4 w-32" />
                <SkeletonCard lines={2} />
                <SkeletonCard lines={2} />
              </div>
            ))}
          </div>
        </div>
      );
    case 'detail':
      return (
        <div aria-busy="true">
          {header}
          <div className="grid gap-(--sp-4) lg:grid-cols-[2fr_1fr]">
            <SkeletonCard lines={8} />
            <SkeletonCard lines={4} />
          </div>
        </div>
      );
    default:
      return (
        <div aria-busy="true">
          {header}
          <SkeletonTable rows={8} />
        </div>
      );
  }
}
