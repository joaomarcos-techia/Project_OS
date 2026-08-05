import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId } from '@/lib/auth/tenant-context';
import { getPlanChangeOverview } from '@/contexts/billing/internal/plan-changes';

import { PlanChangeForm } from './plan-change-form';

export const dynamic = 'force-dynamic';

export default async function AssinaturaPage() {
  await requireCachedPermission(PERMISSIONS.MANAGE_SETTINGS);
  const clinicId = await requireClinicId();
  const overview = await getPlanChangeOverview(clinicId);

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
