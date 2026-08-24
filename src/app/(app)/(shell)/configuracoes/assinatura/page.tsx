import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { getPlanChangeOverview, PlanChangeError } from '@/contexts/billing/internal/plan-changes';

import { PlanChangeForm } from './plan-change-form';

export const dynamic = 'force-dynamic';

export default async function AssinaturaPage() {
  const user = await requireUser();
  // O menu de configurações pode ser alcançado por perfis sem esta permissão.
  // Negativa de RBAC é estado esperado de UI, não exceção de servidor/Sentry.
  if (!user.permissions.includes(PERMISSIONS.MANAGE_SETTINGS)) {
    return (
      <>
        <PageHeader
          crumbs={[{ label: 'Gestão', href: '/configuracoes/gestao' }, { label: 'Assinatura' }]}
          title="Assinatura"
          description="Compare planos, acompanhe limites e altere sua assinatura com segurança."
        />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para gerenciar a assinatura da clínica.
        </Alert>
      </>
    );
  }
  const clinicId = await requireClinicId();
  let overview;
  try {
    overview = await getPlanChangeOverview(clinicId);
  } catch (error) {
    if (!(error instanceof PlanChangeError) || error.code !== 'subscription_not_found') throw error;
    return (
      <>
        <PageHeader
          crumbs={[{ label: 'Gestão', href: '/configuracoes/gestao' }, { label: 'Assinatura' }]}
          title="Assinatura"
          description="Compare planos, acompanhe limites e altere sua assinatura com segurança."
        />
        <EmptyState
          title="Assinatura em configuração"
          description="Esta clínica ainda não possui uma assinatura provisionada. Alterações de plano ficam indisponíveis até a conclusão do provisionamento."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Gestão', href: '/configuracoes/gestao' }, { label: 'Assinatura' }]}
        title="Assinatura"
        description="Compare planos, acompanhe limites e altere sua assinatura com segurança."
      />
      <PlanChangeForm {...overview} />
    </>
  );
}
