import { PageSkeleton } from '@/components/ui/page-skeleton';

/**
 * Vale para todo o segmento. `cards` porque a anatomia mais comum da seção é a
 * página de categoria — uma grade de cards; as sub-rotas sem `loading.tsx`
 * próprio herdam o mesmo limite de Suspense.
 */
export default function Loading() {
  return <PageSkeleton variant="cards" />;
}
