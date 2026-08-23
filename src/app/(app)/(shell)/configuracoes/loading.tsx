import { PageSkeleton } from '@/components/ui/page-skeleton';

/**
 * Vale para todo o segmento: as sub-rotas sem `loading.tsx` proprio (perfil,
 * horarios, whatsapp, agente, lgpd, auditoria) herdam este limite de Suspense.
 */
export default function Loading() {
  return <PageSkeleton variant="detail" />;
}
