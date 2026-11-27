import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { getPlanChangeOverview, PlanChangeError } from '@/contexts/billing/internal/plan-changes';
import { getDeferredSubscriptionOverview } from '@/contexts/billing/internal/deferred-checkout';

import { PlanChangeForm } from './plan-change-form';
import { DeferredSubscription } from './deferred-subscription';

export const dynamic = 'force-dynamic';

export default async function AssinaturaPage() {
  const user = await requireUser();
  // O menu de configurações pode ser alcançado por perfis sem esta permissão.
  // Negativa de RBAC é estado esperado de UI, não exceção de servidor/Sentry.
  if (!user.permissions.includes(PERMISSIONS.MANAGE_SETTINGS)) {
    return (
      <>
        <PageHeader
          crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Assinatura' }]}
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
  const deferred = await getDeferredSubscriptionOverview(clinicId);
  if (deferred)
    return (
      <>
        <PageHeader
          title="Assinatura"
          description="Acompanhe sua avaliação e a contratação do plano."
        />
        <DeferredSubscription {...deferred} />
      </>
    );
  let overview;
  try {
    overview = await getPlanChangeOverview(clinicId);
  } catch (error) {
    if (error instanceof PlanChangeError && error.code === 'provider_operation_unavailable') {
      return (
        <>
          <PageHeader title="Assinatura" description="Acompanhe o plano da sua clínica." />
          <Alert variant="warning" title="Gestão da assinatura temporariamente indisponível">
            Não foi possível carregar a integração desta assinatura. Tente novamente em instantes ou
            entre em contato com o suporte. Nenhuma alteração de plano foi realizada.
          </Alert>
        </>
      );
    }
    if (!(error instanceof PlanChangeError) || error.code !== 'subscription_not_found') throw error;
    return (
      <>
        <PageHeader
          crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Assinatura' }]}
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
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Assinatura' }]}
        title="Assinatura"
        description="Compare planos, acompanhe limites e altere sua assinatura com segurança."
      />
      <PlanChangeForm {...overview} />
    </>
  );
}
