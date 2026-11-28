import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { Alert } from '@/components/ui/alert';
import Link from 'next/link';
import { requireClinicId } from '@/lib/auth/tenant-context';
import { loadTrialAccessForRequest } from '../../_painel/trial-access-request';

import { loadPagamentosPage } from './data';
import { DepositPolicyForm } from './deposit-policy-form';
import { PaymentAccountPanel } from './payment-account-panel';
import { AsaasFeesPanel } from './asaas-fees-panel';
import { FinancialPoliciesPanel } from './financial-policies-panel';
import { PaymentReadiness } from './payment-readiness';

export const dynamic = 'force-dynamic';

/**
 * /configuracoes/pagamentos — conexão da conta Asaas DA CLÍNICA (ADR-049).
 *
 * O gate precede a leitura, como nas demais telas de Configurações: mesmo o
 * metadado (nome da conta, desde quando está conectada) é informação
 * administrativa de recebimento. A MESMA permissão é exigida de novo dentro da
 * Server Action — a tela some para quem não pode ver, e a ação recusa quem tentar
 * chamá-la direto, sem depender da tela ter sumido.
 */
export default async function PagamentosSettingsPage() {
  const gate = await pageGate([PERMISSIONS.MANAGE_FINANCIAL]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Pagamentos' }]}
        title="Pagamentos"
        description="Seu perfil não tem permissão para configurar o recebimento da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }

  const trial = await loadTrialAccessForRequest(await requireClinicId());
  if (trial?.restricted) {
    return (
      <Alert title="Asaas disponível após o pagamento">
        A conexão da conta recebedora e as cobranças integradas ficam disponíveis após a confirmação
        do pagamento da assinatura Qoro. No trial, você pode testar os registros financeiros manuais
        dentro das cotas.{' '}
        <Link href="/configuracoes/assinatura" className="underline">
          Ver assinatura
        </Link>
      </Alert>
    );
  }
  const data = await loadPagamentosPage();
  return (
    <div className="flex flex-col gap-6">
      <PaymentAccountPanel status={data.account} />
      <PaymentReadiness account={data.account} policy={data.policy} />
      <AsaasFeesPanel hasApiKey={data.account.hasApiKey} />
      <DepositPolicyForm policy={data.policy} hasAccount={data.account.hasApiKey} />
      {data.advancedPoliciesEnabled ? (
        <FinancialPoliciesPanel
          payoutPolicy={data.payoutPolicy}
          payoutRules={data.payoutRules}
          professionals={data.professionals}
          procedures={data.procedures}
        />
      ) : (
        <Alert variant="info">Regras de repasse estão disponíveis nos planos Clínica e Pro.</Alert>
      )}
    </div>
  );
}
