import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId } from '@/lib/auth/tenant-context';
import { getPlanChangeOverview, PlanChangeError } from '@/contexts/billing/internal/plan-changes';

import { PlanChangeForm } from './plan-change-form';

export const dynamic = 'force-dynamic';

export default async function AssinaturaPage() {
  await requireCachedPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  let overview;
  try {
    overview = await getPlanChangeOverview(clinicId);
  } catch (error) {
    if (!(error instanceof PlanChangeError) || error.code !== 'subscription_not_found') throw error;
    return (
      <>
        <PageHeader
          title="Assinatura"
          description="Compare planos, acompanhe limites e altere sua assinatura com seguranÃ§a."
        />
        <EmptyState
          title="Assinatura em configuraÃ§Ã£o"
          description="Esta clÃ­nica ainda nÃ£o possui uma assinatura provisionada. AlteraÃ§Ãµes de plano ficam indisponÃ­veis atÃ© a conclusÃ£o do provisionamento."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Assinatura"
        description="Compare planos, acompanhe limites e altere sua assinatura com segurança."
      />
      <PlanChangeForm {...overview} />
    </>
  );
}
